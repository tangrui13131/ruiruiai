import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OrchestrationRepository,
  PersistentAgentRegistry,
  ProjectId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type { ProjectRunStatus } from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  deliverySnapshotPath,
  saveDeliverySnapshot,
} from '../src/delivery-snapshot.ts'
import { ProjectDerivationService } from '../src/project-derivation.ts'

const roots: string[] = []
const repositories: OrchestrationRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ProjectDerivationService', () => {
  it('creates an upgrade successor with the frozen Team and project memory', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source, run, workspace } = await createSource(repository, root, {
      name: 'Operations v1',
      requirement: 'Build an operations console.',
    })
    repository.saveProjectMemoryEntry({
      id: 'memory-source-design',
      projectId: source.id,
      kind: 'design-decision',
      key: 'design-system',
      value: { summary: 'Compact dashboard' },
      source: 'test',
      createdAt: '2026-11-04T00:01:00.000Z',
    })

    const service = new ProjectDerivationService({ store: repository })
    const targetId = ProjectId('target-project')
    const target = await service.derive({
      sourceProjectId: source.id,
      targetProjectId: targetId,
      name: 'Operations v2',
      mode: 'UPGRADE',
      changeRequest: 'Add search filters and a mobile layout.',
    })

    expect(target).toMatchObject({
      id: targetId,
      name: 'Operations v2',
      requirement: 'Build an operations console.',
      sourceProjectId: source.id,
      sourceProjectName: 'Operations v1',
      sourceRunId: run.id,
      derivationMode: 'UPGRADE',
      changeRequest: 'Add search filters and a mobile layout.',
    })
    expect(repository.getProject(source.id)).toMatchObject({ name: 'Operations v1' })
    expect(repository.listProjects().find(project => project.id === source.id))
      .toMatchObject({ childProjectCount: 1 })
    expect(repository.getProjectSnapshot(source.id, 0, 10)?.tasks).toEqual([])
    const targetBinding = repository.getProjectTeamBinding(targetId)
    const sourceBinding = repository.getProjectTeamBinding(source.id)
    expect(targetBinding?.teamVersion).toEqual(sourceBinding?.teamVersion)
    expect(targetBinding?.projectId).toBe(targetId)
    expect(repository.listProjectMemoryEntries(targetId)).toEqual([
      expect.objectContaining({
        kind: 'design-decision',
        key: 'design-system',
        value: { summary: 'Compact dashboard' },
      }),
    ])
    expect(readFileSync(join(deliverySnapshotPath(workspace), 'src', 'App.tsx'), 'utf8'))
      .toContain('v1')
  })

  it('reuses an existing delivery snapshot for an upgrade', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source, workspace } = await createSource(repository, root)
    await saveDeliverySnapshot(workspace)

    const target = await new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-existing-snapshot'),
      name: 'Existing snapshot',
      mode: 'UPGRADE',
      changeRequest: 'Keep the existing result.',
    })

    expect(target.id).toBe('target-existing-snapshot')
  })

  it('creates a regeneration successor without an upgrade request or source snapshot read', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)

    const target = await new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-regenerate'),
      name: 'Regenerated',
      mode: 'REGENERATE',
    })

    expect(target).toMatchObject({
      derivationMode: 'REGENERATE',
      sourceProjectId: source.id,
    })
    expect(target.changeRequest).toBeUndefined()
  })

  it('rejects a missing source project', async () => {
    const repository = createRepository()

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: ProjectId('missing-source'),
      targetProjectId: ProjectId('target'),
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({ code: 'SOURCE_PROJECT_NOT_FOUND' })
  })

  it('rejects an existing target project', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)
    const targetId = ProjectId('target-existing')
    repository.createProject({
      id: targetId,
      name: 'Existing',
      requirement: 'Already exists.',
      createdAt: '2026-11-04T00:02:00.000Z',
    }, [])

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: targetId,
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({ code: 'TARGET_PROJECT_EXISTS' })
  })

  it('rejects an upgrade without a non-empty change request', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-missing-request'),
      name: 'Target',
      mode: 'UPGRADE',
      changeRequest: '   ',
    })).rejects.toMatchObject({ code: 'UPGRADE_REQUEST_REQUIRED' })
  })

  it('rejects a source with an active run', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root, { runStatus: 'RUNNING' })

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-running-source'),
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({ code: 'SOURCE_PROJECT_RUNNING' })
  })

  it('rejects a source whose latest run is not passed', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root, { runStatus: 'FAILED' })

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-failed-source'),
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({ code: 'SOURCE_RUN_NOT_PASSED' })
  })

  it('rejects a source without a frozen Team binding', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root, { binding: false })

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-no-binding'),
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({ code: 'SOURCE_TEAM_BINDING_UNAVAILABLE' })
  })

  it('rejects a passed run without a workspace path', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)
    const passedRun = repository.listProjectRuns(source.id)[0]!
    repository.listProjectRuns = () => [{ ...passedRun, workspacePath: undefined }]

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-no-workspace'),
      name: 'Target',
      mode: 'UPGRADE',
      changeRequest: 'Upgrade it.',
    })).rejects.toMatchObject({ code: 'SOURCE_SNAPSHOT_UNAVAILABLE' })
  })

  it('rejects an upgrade when the source workspace cannot be snapshotted', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)
    const passedRun = repository.listProjectRuns(source.id)[0]!
    repository.listProjectRuns = () => [{
      ...passedRun,
      workspacePath: join(root, 'missing-workspace'),
    }]

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-unreadable-workspace'),
      name: 'Target',
      mode: 'UPGRADE',
      changeRequest: 'Upgrade it.',
    })).rejects.toMatchObject({ code: 'SOURCE_SNAPSHOT_UNAVAILABLE' })
  })

  it('wraps create failures with stable guidance', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)
    repository.createProject = () => { throw new Error('database rejected the write') }

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-create-error'),
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({
      code: 'TARGET_PROJECT_CREATE_FAILED',
      message: 'database rejected the write',
    })
  })

  it('uses a stable create failure message for non-Error throws', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)
    const nonError = Object.freeze({ reason: 'bad write' })
    repository.createProject = () => { throw nonError }

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-create-object-error'),
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({
      code: 'TARGET_PROJECT_CREATE_FAILED',
      message: 'Could not create the derived project',
    })
  })

  it('rejects a create path whose project disappears from the summary read', async () => {
    const repository = createRepository()
    const root = createRoot()
    const { source } = await createSource(repository, root)
    const originalCreate = repository.createProject.bind(repository)
    repository.createProject = (...args) => {
      originalCreate(...args)
      repository.listProjects = () => []
    }

    await expect(new ProjectDerivationService({ store: repository }).derive({
      sourceProjectId: source.id,
      targetProjectId: ProjectId('target-disappeared'),
      name: 'Target',
      mode: 'REGENERATE',
    })).rejects.toMatchObject({
      code: 'TARGET_PROJECT_CREATE_FAILED',
      message: 'Derived project "target-disappeared" disappeared after creation',
    })
  })
})

function createRepository(): OrchestrationRepository {
  const repository = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
  repositories.push(repository)
  return repository
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'future-cup-project-derivation-'))
  roots.push(root)
  return root
}

async function createSource(
  repository: OrchestrationRepository,
  root: string,
  options: {
    readonly name?: string
    readonly requirement?: string
    readonly binding?: boolean
    readonly runStatus?: ProjectRunStatus
  } = {},
) {
  const source = {
    id: ProjectId(`source-${String(repositories.length)}-${String(roots.length)}`),
    name: options.name ?? 'Operations v1',
    requirement: options.requirement ?? 'Build an operations console.',
    createdAt: '2026-11-04T00:00:00.000Z',
  }
  const registry = new PersistentAgentRegistry(repository)
  const binding = options.binding === false
    ? undefined
    : await registry.freezeProject(source.id, await registry.ensureDefaultTeam())
  repository.createProject(source, [], undefined, binding)
  const workspace = join(root, 'source-workspace')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), '{"name":"source"}\n')
  writeFileSync(join(workspace, 'src', 'App.tsx'), 'export const App = () => <main>v1</main>\n')
  const run = repository.createProjectRun(source.id, 'source-worker', 1n, workspace)
  const status = options.runStatus ?? 'PASSED'
  if (status !== 'RUNNING') repository.finishProjectRun(run.id, status)
  return { source, run, workspace }
}
