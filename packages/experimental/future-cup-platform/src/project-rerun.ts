/** Clone a terminal project into a fresh project so it can run again. */

import { randomUUID } from 'node:crypto'
import {
  ProjectTeamBindingId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type {
  PlatformProjectSummary,
  PlatformStore,
  ProjectRecord,
  ProjectTeamBinding,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'

/** Stable failures raised while cloning a project for a rerun. */
export type ProjectRerunErrorCode =
  | 'SOURCE_PROJECT_NOT_FOUND'
  | 'SOURCE_PROJECT_RUNNING'
  | 'SOURCE_TEAM_BINDING_UNAVAILABLE'
  | 'TARGET_PROJECT_EXISTS'
  | 'TARGET_PROJECT_CREATE_FAILED'

/** Typed project rerun failure. */
export class ProjectRerunError extends Error {
  /**
   * @param message - actionable failure description.
   * @param code - stable machine-readable code.
   */
  constructor(message: string, readonly code: ProjectRerunErrorCode) {
    super(message)
    this.name = 'ProjectRerunError'
  }
}

/** Inputs accepted by {@link ProjectRerunService.rerun}. */
export interface RerunProjectInput {
  readonly sourceProjectId: ProjectRecord['id']
  readonly targetProjectId: ProjectRecord['id']
  readonly name?: string | undefined
}

/** Persistence owner used by one project rerun clone. */
export interface ProjectRerunServiceOptions {
  readonly store: PlatformStore
}

/** Clone a terminal project without linking it to the source as a derivation. */
export class ProjectRerunService {
  constructor(private readonly options: ProjectRerunServiceOptions) {}

  /**
   * Create one independent copy of a terminal project.
   * @param input - source, target identity, and optional display name.
   * @returns the newly persisted project summary.
   */
  async rerun(input: RerunProjectInput): Promise<PlatformProjectSummary> {
    const source = await this.options.store.getProject(input.sourceProjectId)
    if (source === undefined) {
      throw new ProjectRerunError(
        `Project "${input.sourceProjectId}" was not found`,
        'SOURCE_PROJECT_NOT_FOUND',
      )
    }
    if (await this.options.store.getProject(input.targetProjectId) !== undefined) {
      throw new ProjectRerunError(
        `Project "${input.targetProjectId}" already exists`,
        'TARGET_PROJECT_EXISTS',
      )
    }
    const runs = await this.options.store.listProjectRuns(input.sourceProjectId)
    if (runs.some(run => run.status === 'RUNNING')) {
      throw new ProjectRerunError(
        `Project "${input.sourceProjectId}" has an active run`,
        'SOURCE_PROJECT_RUNNING',
      )
    }
    const sourceBinding = await this.options.store.getProjectTeamBinding(input.sourceProjectId)
    if (sourceBinding === undefined) {
      throw new ProjectRerunError(
        `Project "${input.sourceProjectId}" has no frozen Team binding`,
        'SOURCE_TEAM_BINDING_UNAVAILABLE',
      )
    }
    const sourceMemory = await this.options.store.listProjectMemoryEntries(input.sourceProjectId)
    const createdAt = new Date().toISOString()
    const target: ProjectRecord = {
      id: input.targetProjectId,
      name: (input.name ?? `${source.name} · 重跑`).trim().slice(0, 120),
      requirement: source.requirement,
      createdAt,
    }
    const binding = cloneBinding(sourceBinding, input.targetProjectId)
    const memoryEntries = sourceMemory.map(entry => ({
      ...entry,
      id: `memory-rerun-${randomUUID()}`,
      projectId: input.targetProjectId,
      source: `rerun:${input.sourceProjectId}`,
      createdAt,
    }))
    try {
      await this.options.store.createProject(target, [], undefined, binding, memoryEntries)
    } catch (error: unknown) {
      throw new ProjectRerunError(
        error instanceof Error ? error.message : 'Could not create the rerun project',
        'TARGET_PROJECT_CREATE_FAILED',
      )
    }
    const created = (await this.options.store.listProjects())
      .find(project => project.id === input.targetProjectId)
    if (created === undefined) {
      throw new ProjectRerunError(
        `Rerun project "${input.targetProjectId}" disappeared after creation`,
        'TARGET_PROJECT_CREATE_FAILED',
      )
    }
    return created
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
