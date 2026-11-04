import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentId,
  DagEngine,
  defaultAgentProfiles,
  OrchestrationRepository,
  PersistentAgentRegistry,
  ProjectId,
  TaskId,
  VerificationReportId,
  WorkflowRunId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type {
  OrchestrationStore,
  ProjectRunRecord,
  TaskDefinition,
  TeamRunResult,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  FutureCupRunLauncher,
  ProjectRunConflictError,
  ProjectRunStartError,
  ProjectRunSettlementPendingError,
  ProjectRunSettlementTimeoutError,
} from '../src/run-launcher.ts'
import { saveDeliverySnapshot } from '../src/delivery-snapshot.ts'
import type {
  FutureCupRunTeam,
  FutureCupRunTeamRequest,
} from '../src/run-launcher.ts'

const roots: string[] = []
const repositories: OrchestrationRepository[] = []

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'future-cup-launcher-'))
  roots.push(root)
  const repository = new OrchestrationRepository(':memory:', {
    journalMode: 'delete',
  })
  repositories.push(repository)
  const projectId = ProjectId('project-run-launcher')
  repository.createProject({
    id: projectId,
    name: 'Launcher',
    requirement: 'Build a dashboard',
    createdAt: '2026-10-31T12:00:00.000Z',
  }, [])
  return {
    root,
    repository,
    project: repository.listProjects()[0]!,
  }
}

function launcherTask(
  id: string,
  role: TaskDefinition['role'],
  dependencies: string[] = [],
): TaskDefinition {
  return {
    id: TaskId(id),
    title: id,
    description: `${id} description`,
    role,
    priority: 50,
    dependencies: dependencies.map(TaskId),
    requiredCapabilities: role === 'frontend' ? { frontend: 0.6 } : {},
    writeScopes: [],
  }
}

function teamResult(request: FutureCupRunTeamRequest, status: 'PASSED' | 'ESCALATED'): TeamRunResult {
  const verification = {
    id: VerificationReportId('verification-launcher'),
    projectId: request.project.id,
    status: status === 'PASSED' ? 'PASS' as const : 'FAIL' as const,
    failureSignature: status === 'PASSED' ? undefined : 'signature',
    report: {
      status: status === 'PASSED' ? 'PASS' : 'FAIL',
      screenshots: [],
    },
    createdAt: '2026-10-31T12:00:01.000Z',
  }
  const workflow = {
    id: WorkflowRunId('workflow-launcher'),
    projectId: request.project.id,
    status,
    repairRound: 0,
    createdAt: '2026-10-31T12:00:01.000Z',
    updatedAt: '2026-10-31T12:00:02.000Z',
  }
  return {
    projectId: request.project.id,
    planner: { projectName: 'Launcher', pages: [], tasks: [] },
    verificationSpec: { summary: 'none', pages: [], interactions: [] },
    tasks: [],
    decisions: [],
    executions: [],
    verification,
    verificationReports: [verification],
    repairs: [],
    workflow,
    workspace: request.workspace,
  }
}

async function waitForTerminalRun(
  repository: OrchestrationRepository,
  projectId: ProjectId,
): Promise<ProjectRunRecord> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const run = repository.listProjectRuns(projectId).at(-1)
    if (run !== undefined && run.status !== 'RUNNING') return run
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('project run did not settle before the test deadline')
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('condition did not become true before the test deadline')
}

function withFinishInterceptor(
  repository: OrchestrationRepository,
  finish: (
    original: OrchestrationStore['finishProjectRun'],
    ...args: Parameters<OrchestrationStore['finishProjectRun']>
  ) => ReturnType<OrchestrationStore['finishProjectRun']>,
): OrchestrationStore {
  const store: OrchestrationStore = repository
  const original = store.finishProjectRun.bind(store)
  store.finishProjectRun = (...args) => finish(original, ...args)
  return store
}

function withProjectRunReader(
  store: OrchestrationStore,
  read: OrchestrationStore['getProjectRun'],
): OrchestrationStore {
  store.getProjectRun = read
  return store
}

describe('FutureCupRunLauncher', () => {
  it('restores a source snapshot into an upgrade workspace before Agent execution', async () => {
    const { root, repository } = setupProject()
    const sourceId = ProjectId('project-upgrade-source')
    const sourceWorkspace = join(root, 'source-workspace')
    mkdirSync(join(sourceWorkspace, 'src'), { recursive: true })
    writeFileSync(join(sourceWorkspace, 'src', 'App.tsx'), 'export const App = () => <main>v1</main>\n')
    repository.createProject({
      id: sourceId,
      name: 'Source',
      requirement: 'Build the source page.',
      createdAt: '2026-10-31T12:00:00.000Z',
    }, [])
    const sourceRun = repository.createProjectRun(sourceId, 'source-worker', 1n, sourceWorkspace)
    repository.finishProjectRun(sourceRun.id, 'PASSED')
    await saveDeliverySnapshot(sourceWorkspace)
    const targetId = ProjectId('project-upgrade-target')
    repository.createProject({
      id: targetId,
      name: 'Source v2',
      requirement: 'Build the source page.',
      createdAt: '2026-10-31T12:01:00.000Z',
      sourceProjectId: sourceId,
      sourceProjectName: 'Source',
      sourceRunId: sourceRun.id,
      derivationMode: 'UPGRADE',
      changeRequest: 'Add search.',
    }, [])
    const target = repository.listProjects().find(project => project.id === targetId)!
    let restoredSource = ''
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: request => ({
        async run() {
          restoredSource = readFileSync(join(request.workspace, 'src', 'App.tsx'), 'utf8')
          return teamResult(request, 'PASSED')
        },
        async close() {},
      }),
    })
    try {
      await launcher.start(target)
      await waitForTerminalRun(repository, targetId)
      expect(restoredSource).toContain('v1')
    } finally {
      await launcher.close()
    }
  })

  it('persists a passing run, preview, lease release, and terminal event', async () => {
    const { root, repository, project } = setupProject()
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 1, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: request => ({
        async run() {
          mkdirSync(join(request.workspace, 'dist'), { recursive: true })
          writeFileSync(join(request.workspace, 'dist/index.html'), '<main>ok</main>')
          return teamResult(request, 'PASSED')
        },
        async close() {},
      }),
    })
    try {
      const started = await launcher.start(project)
      const run = await waitForTerminalRun(repository, project.id)
      expect(run.id).toBe(started.runId)
      expect(run.status).toBe('PASSED')
      expect(run.previewPath).toContain('dist')
      expect(repository.getWorkflowLease(`workflow:${project.id}`))
        .toMatchObject({ ownerId: undefined })
      expect(repository.listProductEvents(project.id, 0, 10).map(event => event.type))
        .toEqual(['run.started', 'run.completed'])
    } finally {
      await launcher.close()
    }
  })

  it('launches only the project frozen team definitions', async () => {
    const { root, repository, project } = setupProject()
    const registry = new PersistentAgentRegistry(repository)
    const teamVersionId = await registry.ensureDefaultTeam()
    repository.bindProjectTeam(await registry.freezeProject(project.id, teamVersionId))
    let launchedProfiles: readonly string[] = []
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: (request) => {
        launchedProfiles = (request.profiles ?? defaultAgentProfiles())
          .map(profile => profile.id)
        return {
          async run() {
            return teamResult(request, 'PASSED')
          },
          async close() {},
        }
      },
    })
    try {
      await launcher.start(project)
      await waitForTerminalRun(repository, project.id)
      expect(launchedProfiles).toEqual(expect.arrayContaining([
        'frontend-1.0.0:instance-1',
        'frontend-1.0.0:instance-2',
        'planner-1.0.0:instance-1',
      ]))
    } finally {
      await launcher.close()
    }
  })

  it('rejects concurrent starts and converts runtime closure into a cancelled run', async () => {
    const { root, repository, project } = setupProject()
    let rejectRun!: (error: Error) => void
    let closed = false
    const pending = new Promise<TeamRunResult>((_resolve, reject) => {
      rejectRun = reject
    })
    const team: FutureCupRunTeam = {
      run: async () => await pending,
      close: async () => {
        if (closed) return
        closed = true
        rejectRun(new Error('runtime closed'))
      },
    }
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: () => team,
    })
    try {
      await launcher.start(project)
      await expect(launcher.start(project)).rejects.toBeInstanceOf(ProjectRunConflictError)
      expect(await launcher.cancel(project.id)).toBe(true)
      const run = await waitForTerminalRun(repository, project.id)
      expect(run.status).toBe('CANCELLED')
      expect(repository.listProductEvents(project.id, 0, 10).at(-1)?.type)
        .toBe('run.cancelled')
    } finally {
      await launcher.close()
    }
  })

  it('records a real runtime failure without reporting success', async () => {
    const { root, repository, project } = setupProject()
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: () => ({
        run: async () => { throw new Error('provider unavailable') },
        close: async () => {},
      }),
    })
    try {
      await launcher.start(project)
      const run = await waitForTerminalRun(repository, project.id)
      expect(run.status).toBe('FAILED')
      expect(run.error).toMatchObject({ message: 'provider unavailable' })
      expect(repository.listProductEvents(project.id, 0, 10).at(-1)?.type)
        .toBe('run.failed')
    } finally {
      await launcher.close()
    }
  })

  it('keeps the lease alive when createTeam fails and the first failure settlement fails', async () => {
    const { root, repository, project } = setupProject()
    let finishCalls = 0
    const store = withFinishInterceptor(repository, async (original, ...args) => {
      finishCalls += 1
      if (finishCalls === 1) {
        throw Object.assign(new Error('database unavailable'), { code: 'P1001' })
      }
      return await Promise.resolve(original(...args))
    })
    const launcher = new FutureCupRunLauncher({
      store,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 100,
      heartbeatIntervalMs: 20,
      settlementRetryMs: 120,
      settlementWaitMs: 1_000,
      createTeam: () => {
        throw new Error('team setup failed')
      },
    })
    await expect(launcher.start(project)).rejects.toBeInstanceOf(ProjectRunStartError)
    const run = repository.listProjectRuns(project.id)[0]
    expect(run).toMatchObject({
      status: 'FAILED',
      error: { message: 'team setup failed' },
    })
    expect(finishCalls).toBe(2)
    expect(repository.getWorkflowLease(`workflow:${project.id}`))
      .toMatchObject({ ownerId: undefined })
    expect(launcher.settlementIssues()).toEqual([])
    await launcher.close()
  })

  it('waits for an in-flight startup during close and settles it as failed', async () => {
    const { root, repository, project } = setupProject()
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return {
          run: async () => { throw new Error('must not run') },
          close: async () => {},
        }
      },
    })
    const starting = launcher.start(project)
    await new Promise(resolve => setTimeout(resolve, 10))
    await launcher.close()
    await expect(starting).rejects.toThrow(/closed during startup/)
    const runs = repository.listProjectRuns(project.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      status: 'FAILED',
      error: { code: 'PROJECT_RUN_FAILED' },
    })
  })

  it('reconciles a stale RUNNING row after acquiring an expired lease', async () => {
    const { root, repository, project } = setupProject()
    const stale = repository.createProjectRun(
      project.id,
      'dead-process',
      1n,
      join(root, 'stale-workspace'),
    )
    let release!: () => void
    const pending = new Promise<TeamRunResult>((resolve) => {
      release = () => { resolve(teamResult({
        project,
        run: stale,
        store: repository,
        runRoot: root,
        workspace: join(root, 'workspace'),
        homeRoot: join(root, 'homes'),
        screenshotDir: join(root, 'screenshots'),
        profiles: defaultAgentProfiles(),
      }, 'PASSED')) }
    })
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: () => ({
        run: async () => await pending,
        close: async () => { release() },
      }),
    })
    try {
      await launcher.start(project)
      expect(repository.getProjectRun(stale.id)).toMatchObject({
        status: 'FAILED',
        error: { code: 'PROJECT_RUN_INTERRUPTED' },
      })
      expect(repository.listProjectRuns(project.id).map(run => run.status))
        .toEqual(['FAILED', 'RUNNING'])
      await launcher.cancel(project.id)
    } finally {
      await launcher.close()
    }
  })

  it('cancels an orphaned RUNNING project after acquiring its expired lease', async () => {
    const { root, repository, project } = setupProject()
    const stale = repository.createProjectRun(
      project.id,
      'dead-process',
      1n,
      join(root, 'stale-workspace'),
    )
    const executionId = repository.startExecution(
      project.id,
      TaskId('planner'),
      AgentId('planner'),
    )
    repository.acquireWorkflowLease(
      `workflow:${project.id}`,
      project.id,
      'dead-process',
      1,
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
    })
    try {
      expect(await launcher.cancel(project.id)).toBe(true)
      expect(repository.getProjectRun(stale.id)?.status).toBe('CANCELLED')
      expect(repository.listExecutions(project.id)).toEqual([
        expect.objectContaining({ id: executionId, status: 'CANCELLED' }),
      ])
      expect(repository.getWorkflowLease(`workflow:${project.id}`))
        .toMatchObject({ ownerId: undefined })
      expect(repository.listProductEvents(project.id, 0, 10).at(-1)?.type)
        .toBe('run.cancelled')
    } finally {
      await launcher.close()
    }
  })

  it('renews the startup lease while interrupted-run recovery exceeds the lease duration', async () => {
    const { root, repository, project } = setupProject()
    const stale = repository.createProjectRun(
      project.id,
      'dead-process',
      1n,
      join(root, 'stale-workspace'),
    )
    const resourceId = `workflow:${project.id}`
    let leaseValidAtReconcileFinish = false
    const store = withFinishInterceptor(repository, async (original, ...args) => {
      if (args[0] === stale.id) {
        const lease = repository.getWorkflowLease(resourceId)
        leaseValidAtReconcileFinish = lease?.ownerId !== undefined
          && Date.parse(lease.expiresAt) > Date.now()
      }
      return await Promise.resolve(original(...args))
    })
    const listProjectRuns = store.listProjectRuns.bind(store)
    let delayedRecovery = false
    store.listProjectRuns = async (...args) => {
      if (!delayedRecovery) {
        delayedRecovery = true
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      return await listProjectRuns(...args)
    }
    let release!: () => void
    const pending = new Promise<TeamRunResult>((resolve) => {
      release = () => {
        resolve(teamResult({
          project,
          run: stale,
          store,
          runRoot: root,
          workspace: join(root, 'workspace'),
          homeRoot: join(root, 'homes'),
          screenshotDir: join(root, 'screenshots'),
          profiles: defaultAgentProfiles(),
        }, 'PASSED'))
      }
    })
    const launcher = new FutureCupRunLauncher({
      store,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 200,
      heartbeatIntervalMs: 25,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: () => ({
        run: async () => await pending,
        close: async () => { release() },
      }),
    })
    try {
      await launcher.start(project)
      expect(delayedRecovery).toBe(true)
      expect(leaseValidAtReconcileFinish).toBe(true)
      const lease = repository.getWorkflowLease(resourceId)
      expect(lease?.ownerId).toBeDefined()
      expect(Date.parse(lease?.expiresAt ?? '')).toBeGreaterThan(Date.now())
      await launcher.cancel(project.id)
    } finally {
      await launcher.close()
    }
  })

  it('idempotently clears stale DAG and non-DAG executions before retrying', async () => {
    const { root, repository, project } = setupProject()
    const dag = await DagEngine.create(repository, {
      id: project.id,
      name: project.name,
      requirement: project.requirement,
    }, [
      launcherTask('dashboard', 'frontend'),
      launcherTask('integration', 'integration', ['dashboard']),
    ])
    await dag.startTask(TaskId('dashboard'), AgentId('frontend-a'))
    const stale = repository.createProjectRun(
      project.id,
      'dead-process',
      1n,
      join(root, 'stale-workspace'),
    )
    const taskExecutionId = repository.startExecution(
      project.id,
      TaskId('dashboard'),
      AgentId('frontend-a'),
    )
    const plannerExecutionId = repository.startExecution(
      project.id,
      TaskId('planner'),
      AgentId('planner'),
    )
    let failInterruptedFinish = true
    const store = withFinishInterceptor(repository, async (original, ...args) => {
      if (args[0] === stale.id && failInterruptedFinish) {
        failInterruptedFinish = false
        throw Object.assign(new Error('transient recovery interruption'), { code: 'P1001' })
      }
      return await Promise.resolve(original(...args))
    })
    const launcher = new FutureCupRunLauncher({
      store,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 100,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: request => ({
        run: async () => teamResult(request, 'PASSED'),
        close: async () => {},
      }),
    })
    try {
      await expect(launcher.start(project)).rejects.toBeInstanceOf(ProjectRunStartError)
      expect(repository.getProjectRun(stale.id)?.status).toBe('RUNNING')
      const tasks = repository.listTasks(project.id)
      expect(tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: TaskId('dashboard'),
          status: 'FAILED',
        }),
        expect.objectContaining({
          id: TaskId('integration'),
          status: 'CANCELLED',
        }),
      ]))
      expect(tasks.find(task => task.id === TaskId('dashboard'))?.failure)
        .toMatchObject({ code: 'PROJECT_RUN_INTERRUPTED' })
      const executions = repository.listExecutions(project.id)
      expect(executions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: taskExecutionId,
          status: 'FAILED',
        }),
        expect.objectContaining({
          id: plannerExecutionId,
          status: 'FAILED',
        }),
      ]))
      expect(executions.find(execution => execution.id === taskExecutionId)?.error)
        .toMatchObject({ code: 'PROJECT_RUN_INTERRUPTED' })
      expect(executions.find(execution => execution.id === plannerExecutionId)?.error)
        .toMatchObject({ code: 'PROJECT_RUN_INTERRUPTED' })
      const agentLoads = executions
        .filter(execution => execution.status === 'RUNNING')
        .reduce<Record<string, number>>((loads, execution) => {
          loads[execution.agentId] = (loads[execution.agentId] ?? 0) + 1
          return loads
        }, {})
      expect(agentLoads).toEqual({})
      expect(repository.listTaskJournal(project.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: TaskId('dashboard'), eventType: 'task/failed' }),
        expect.objectContaining({ taskId: TaskId('integration'), eventType: 'task/blocked' }),
        expect.objectContaining({ taskId: TaskId('integration'), eventType: 'task/cancelled' }),
      ]))
      expect(repository.listProductEvents(project.id, 0, 1_000).map(event => event.type))
        .toEqual(expect.arrayContaining(['task.failed', 'task.cancelled', 'agent.failed']))

      await launcher.start(project)
      expect(repository.getProjectRun(stale.id)).toMatchObject({
        status: 'FAILED',
        error: { code: 'PROJECT_RUN_INTERRUPTED' },
      })
      expect(repository.listTasks(project.id).filter(task => task.status === 'RUNNING')).toEqual([])
      expect(repository.listExecutions(project.id).filter(execution => execution.status === 'RUNNING'))
        .toEqual([])
    } finally {
      await launcher.close()
    }
  })

  it('keeps the lease alive across three transient settlement failures and then succeeds', async () => {
    const { root, repository, project } = setupProject()
    let finishCalls = 0
    const store = withFinishInterceptor(repository, async (original, ...args) => {
      finishCalls += 1
      if (finishCalls <= 3) {
        throw Object.assign(new Error('database unavailable'), { code: 'P1001' })
      }
      return await Promise.resolve(original(...args))
    })
    const launcher = new FutureCupRunLauncher({
      store,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 100,
      heartbeatIntervalMs: 20,
      settlementRetryMs: 120,
      settlementWaitMs: 2_000,
      createTeam: request => ({
        run: async () => teamResult(request, 'PASSED'),
        close: async () => {},
      }),
    })
    try {
      await launcher.start(project)
      const run = await waitForTerminalRun(repository, project.id)
      expect(run.status).toBe('PASSED')
      expect(finishCalls).toBe(4)
      expect(repository.getWorkflowLease(`workflow:${project.id}`))
        .toMatchObject({ ownerId: undefined })
      expect(launcher.settlementIssues()).toEqual([])
    } finally {
      await launcher.close()
    }
  })

  it('recognizes a committed terminal run when the first finish response is lost', async () => {
    const { root, repository, project } = setupProject()
    let finishCalls = 0
    const store = withFinishInterceptor(repository, async (original, ...args) => {
      const run = await Promise.resolve(original(...args))
      finishCalls += 1
      if (finishCalls === 1) {
        throw Object.assign(new Error('connection reset after commit'), { code: 'ECONNRESET' })
      }
      return run
    })
    const launcher = new FutureCupRunLauncher({
      store,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 500,
      heartbeatIntervalMs: 50,
      settlementRetryMs: 10,
      settlementWaitMs: 1_000,
      createTeam: request => ({
        run: async () => teamResult(request, 'PASSED'),
        close: async () => {},
      }),
    })
    try {
      await launcher.start(project)
      const run = await waitForTerminalRun(repository, project.id)
      expect(run.status).toBe('PASSED')
      expect(finishCalls).toBe(1)
      expect(launcher.settlementIssues()).toEqual([])
    } finally {
      await launcher.close()
    }
  })

  it('reports a permanent settlement issue without retrying forever', async () => {
    const { root, repository, project } = setupProject()
    const store = withProjectRunReader(
      withFinishInterceptor(repository, async () => {
        throw Object.assign(new Error('database unavailable'), { code: 'P1001' })
      }),
      () => undefined,
    )
    const launcher = new FutureCupRunLauncher({
      store,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 500,
      heartbeatIntervalMs: 50,
      settlementRetryMs: 10,
      settlementWaitMs: 100,
      createTeam: request => ({
        run: async () => teamResult(request, 'PASSED'),
        close: async () => {},
      }),
    })
    await launcher.start(project)
    await waitForCondition(() => launcher.settlementIssues().length === 1)
    expect(launcher.settlementIssues()[0]).toMatchObject({
      code: 'PROJECT_RUN_NOT_FOUND',
      retryable: false,
    })
    await expect(launcher.cancel(project.id))
      .rejects.toBeInstanceOf(ProjectRunSettlementPendingError)
    expect(repository.listProjectRuns(project.id)[0]?.status).toBe('RUNNING')
    await expect(launcher.close())
      .rejects.toBeInstanceOf(ProjectRunSettlementPendingError)
  })

  it('bounds cancel and close waits while transient settlement continues', async () => {
    const { root, repository, project } = setupProject()
    let fail = true
    const store = withFinishInterceptor(repository, async (original, ...args) => {
      if (fail) throw Object.assign(new Error('database unavailable'), { code: 'P1001' })
      return await Promise.resolve(original(...args))
    })
    const launcher = new FutureCupRunLauncher({
      store,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 200,
      heartbeatIntervalMs: 20,
      settlementRetryMs: 20,
      settlementWaitMs: 60,
      createTeam: request => ({
        run: async () => teamResult(request, 'PASSED'),
        close: async () => {},
      }),
    })
    await launcher.start(project)
    await expect(launcher.cancel(project.id))
      .rejects.toBeInstanceOf(ProjectRunSettlementTimeoutError)
    await expect(launcher.close())
      .rejects.toBeInstanceOf(ProjectRunSettlementTimeoutError)
    expect(repository.listProjectRuns(project.id)[0]?.status).toBe('RUNNING')
    fail = false
    const run = await waitForTerminalRun(repository, project.id)
    expect(run.status).toBe('PASSED')
    await launcher.close()
  })

  it('bounds a hanging team close and remains recoverable after the timeout', async () => {
    const { root, repository, project } = setupProject()
    let rejectRun!: (error: Error) => void
    let resolveClose!: () => void
    const pendingRun = new Promise<TeamRunResult>((_resolve, reject) => {
      rejectRun = reject
    })
    const pendingClose = new Promise<void>((resolve) => {
      resolveClose = resolve
    })
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      leaseDurationMs: 500,
      heartbeatIntervalMs: 50,
      settlementRetryMs: 10,
      settlementWaitMs: 60,
      createTeam: () => ({
        run: async () => await pendingRun,
        close: async () => {
          await pendingClose
        },
      }),
    })
    await launcher.start(project)
    await expect(launcher.cancel(project.id))
      .rejects.toBeInstanceOf(ProjectRunSettlementTimeoutError)
    expect(repository.listProjectRuns(project.id)[0]?.status).toBe('RUNNING')
    resolveClose()
    rejectRun(new Error('runtime closed'))
    const run = await waitForTerminalRun(repository, project.id)
    expect(run.status).toBe('CANCELLED')
    await launcher.close()
  })

  it('executes a self-healing drill over an existing project run workspace', async () => {
    const { root, repository, project } = setupProject()
    const workspace = join(root, 'workspace-previous')
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'App.tsx'), 'export function App() { return <div>Original</div> }\n')

    const prevRun = repository.createProjectRun(project.id, 'owner-prev', 1n, workspace)
    repository.finishProjectRun(prevRun.id, 'PASSED')

    await DagEngine.create(repository, {
      id: project.id,
      name: project.name,
      requirement: project.requirement,
    }, [launcherTask('tester', 'tester')])

    const current = repository.listTasks(project.id)[0]!
    const next = {
      ...current,
      revision: current.revision + 1,
      status: 'COMPLETED' as const,
      result: {
        summary: 'Spec',
        pages: [
          { pageId: 'overview', route: '/', navigationLabel: 'Overview', requiredText: ['Original'] },
          { pageId: 'users', route: '/users', navigationLabel: 'Users', requiredText: ['Users'] },
        ],
        interactions: [
          { fromRoute: '/', clickText: 'Users', expectedRoute: '/users', expectedText: 'Users' },
        ],
      },
    }
    repository.saveTask(next, 'task/completed')

    let drillTeamRan = false
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 1, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 50,
      settlementRetryMs: 10,
      settlementWaitMs: 200,
      createDrillTeam: (request, spec) => ({
        run: async () => {
          drillTeamRan = true
          expect(spec.pages[0]?.pageId).toBe('overview')
          return teamResult(request, 'PASSED')
        },
        close: async () => {},
      }),
    })

    const drillResult = await launcher.startDrill(project, 'preset:typescript-contract')
    expect(drillResult.runId).toBeDefined()
    expect(drillResult.injectedFault?.mode).toBe('preset:typescript-contract')

    const run = await waitForTerminalRun(repository, project.id)
    expect(run.status).toBe('PASSED')
    expect(drillTeamRan).toBe(true)
    await launcher.close()
  })

  it('rejects a self-healing drill when project has no previous workspace', async () => {
    const { root, repository, project } = setupProject()
    const launcher = new FutureCupRunLauncher({
      store: repository,
      workspaceRoot: join(root, 'runs'),
      agentHomeRoot: join(root, 'homes'),
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 1, repairTimeoutMs: 1_000 },
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 50,
      settlementRetryMs: 10,
      settlementWaitMs: 200,
    })

    await expect(launcher.startDrill(project, 'preset:typescript-contract'))
      .rejects.toBeInstanceOf(ProjectRunStartError)
    await launcher.close()
  })
})
