/** Create immutable project successors from an earlier delivered project. */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  ProjectTeamBindingId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type {
  PlatformProjectSummary,
  PlatformStore,
  ProjectDerivationMode,
  ProjectRecord,
  ProjectRunRecord,
  ProjectTeamBinding,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  deliverySnapshotPath,
  saveDeliverySnapshot,
} from './delivery-snapshot.ts'

/** Stable failures raised while deriving one project from another. */
export type ProjectDerivationErrorCode =
  | 'SOURCE_PROJECT_NOT_FOUND'
  | 'SOURCE_PROJECT_RUNNING'
  | 'SOURCE_RUN_NOT_PASSED'
  | 'SOURCE_TEAM_BINDING_UNAVAILABLE'
  | 'SOURCE_SNAPSHOT_UNAVAILABLE'
  | 'UPGRADE_REQUEST_REQUIRED'
  | 'TARGET_PROJECT_EXISTS'
  | 'TARGET_PROJECT_CREATE_FAILED'

/** Typed project derivation failure. */
export class ProjectDerivationError extends Error {
  /**
   * @param message - actionable failure description.
   * @param code - stable machine-readable code.
   */
  constructor(message: string, readonly code: ProjectDerivationErrorCode) {
    super(message)
    this.name = 'ProjectDerivationError'
  }
}

/** Inputs accepted by {@link ProjectDerivationService.derive}. */
export interface DeriveProjectInput {
  readonly sourceProjectId: ProjectRecord['id']
  readonly targetProjectId: ProjectRecord['id']
  readonly name: string
  readonly mode: ProjectDerivationMode
  readonly changeRequest?: string | undefined
}

/** Persistence owner used by one project derivation. */
export interface ProjectDerivationServiceOptions {
  readonly store: PlatformStore
}

/** Create a successor project without mutating its source project. */
export class ProjectDerivationService {
  constructor(private readonly options: ProjectDerivationServiceOptions) {}

  /**
   * Create one successor project.
   * @param input - source, target identity, mode, and upgrade request.
   * @returns the newly persisted project summary.
   */
  async derive(input: DeriveProjectInput): Promise<PlatformProjectSummary> {
    const source = await this.options.store.getProject(input.sourceProjectId)
    if (source === undefined) {
      throw new ProjectDerivationError(
        `Project "${input.sourceProjectId}" was not found`,
        'SOURCE_PROJECT_NOT_FOUND',
      )
    }
    if (await this.options.store.getProject(input.targetProjectId) !== undefined) {
      throw new ProjectDerivationError(
        `Project "${input.targetProjectId}" already exists`,
        'TARGET_PROJECT_EXISTS',
      )
    }
    const sourceRun = await this.requirePassedSourceRun(input.sourceProjectId)
    const changeRequest = input.changeRequest?.trim()
    if (input.mode === 'UPGRADE' && (changeRequest === undefined || changeRequest === '')) {
      throw new ProjectDerivationError(
        'An upgrade request is required when deriving an upgrade project',
        'UPGRADE_REQUEST_REQUIRED',
      )
    }
    if (input.mode === 'UPGRADE') await this.ensureSourceSnapshot(sourceRun)

    const sourceBinding = await this.options.store.getProjectTeamBinding(input.sourceProjectId)
    if (sourceBinding === undefined) {
      throw new ProjectDerivationError(
        `Project "${input.sourceProjectId}" has no frozen Team binding`,
        'SOURCE_TEAM_BINDING_UNAVAILABLE',
      )
    }
    const sourceMemory = await this.options.store.listProjectMemoryEntries(input.sourceProjectId)
    const target: ProjectRecord = {
      id: input.targetProjectId,
      name: input.name.trim(),
      requirement: source.requirement,
      createdAt: new Date().toISOString(),
      sourceProjectId: source.id,
      sourceProjectName: source.name,
      sourceRunId: sourceRun.id,
      derivationMode: input.mode,
      ...changeRequest === undefined || changeRequest === ''
        ? {}
        : { changeRequest },
    }
    const binding = cloneBinding(sourceBinding, input.targetProjectId)
    const memoryEntries = sourceMemory.map(entry => ({
      ...entry,
      id: `memory-derived-${randomUUID()}`,
      projectId: input.targetProjectId,
      source: `derived:${input.sourceProjectId}`,
      createdAt: new Date().toISOString(),
    }))
    try {
      await this.options.store.createProject(target, [], undefined, binding, memoryEntries)
    } catch (error: unknown) {
      throw new ProjectDerivationError(
        error instanceof Error ? error.message : 'Could not create the derived project',
        'TARGET_PROJECT_CREATE_FAILED',
      )
    }
    const created = (await this.options.store.listProjects())
      .find(project => project.id === input.targetProjectId)
    if (created === undefined) {
      throw new ProjectDerivationError(
        `Derived project "${input.targetProjectId}" disappeared after creation`,
        'TARGET_PROJECT_CREATE_FAILED',
      )
    }
    return created
  }

  private async requirePassedSourceRun(projectId: ProjectRecord['id']): Promise<ProjectRunRecord> {
    const runs = await this.options.store.listProjectRuns(projectId)
    if (runs.some(run => run.status === 'RUNNING')) {
      throw new ProjectDerivationError(
        `Project "${projectId}" has an active run`,
        'SOURCE_PROJECT_RUNNING',
      )
    }
    const latest = runs.at(-1)
    if (latest?.status !== 'PASSED') {
      throw new ProjectDerivationError(
        `Project "${projectId}" does not have a passed latest run`,
        'SOURCE_RUN_NOT_PASSED',
      )
    }
    return latest
  }

  private async ensureSourceSnapshot(run: ProjectRunRecord): Promise<void> {
    if (run.workspacePath === undefined) {
      throw new ProjectDerivationError(
        `Passed run "${run.id}" has no workspace`,
        'SOURCE_SNAPSHOT_UNAVAILABLE',
      )
    }
    const snapshot = deliverySnapshotPath(run.workspacePath)
    if (existsSync(snapshot)) return
    try {
      await saveDeliverySnapshot(run.workspacePath)
    } catch (error: unknown) {
      throw new ProjectDerivationError(
        error instanceof Error ? error.message : 'Could not create the source snapshot',
        'SOURCE_SNAPSHOT_UNAVAILABLE',
      )
    }
  }
}

function cloneBinding(
  source: ProjectTeamBinding,
  targetProjectId: ProjectRecord['id'],
): ProjectTeamBinding {
  return Object.freeze({
    ...source,
    id: ProjectTeamBindingId(`${targetProjectId}:${source.teamVersion.id}`),
    projectId: targetProjectId,
  })
}
