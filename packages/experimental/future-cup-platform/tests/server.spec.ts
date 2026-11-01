import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { io as connectSocket } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { z } from 'zod'
import {
  AgentId,
  DagEngine,
  defaultAgentProfiles,
  OrchestrationRepository,
  PersistentAgentRegistry,
  JSON_SCHEMA_DIALECT,
  ProjectId,
  TaskId,
  taskDefinition,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type { PlatformProjectSummary } from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  ProjectRunSettlementPendingError,
  ProjectRunSettlementTimeoutError,
} from '../src/run-launcher.ts'
import { createFutureCupServer } from '../src/server.ts'
import type { FutureCupServer, ProjectRunLauncher } from '../src/server-types.ts'
import {
  structuredProjectProfileSchema,
  teamRecommendationAdoptionResponseSchema,
  teamRecommendationPlanSchema,
  teamRecommendationSaveResponseSchema,
} from '../src/api-contracts.ts'

const servers: FutureCupServer[] = []
const sockets: Socket[] = []
const roots: string[] = []
const healthSchema = z.object({ status: z.literal('ok'), projects: z.number() })
const projectSchema = z.looseObject({ id: z.string(), lastEventSeq: z.number() })
const agentSchema = z.looseObject({ id: z.string(), role: z.string() })
const snapshotSchema = z.looseObject({
  events: z.array(z.looseObject({ seq: z.number() })),
  runs: z.array(z.looseObject({
    id: z.string(),
    fencingToken: z.string(),
    hasWorkspace: z.boolean(),
    hasPreview: z.boolean(),
  })),
})

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect()
  for (const server of servers.splice(0)) await server.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

class FakeLauncher implements ProjectRunLauncher {
  readonly started: string[] = []
  readonly cancelled: string[] = []

  async start(project: PlatformProjectSummary) {
    this.started.push(project.id)
    return { runId: `run-${project.id}` }
  }

  async cancel(projectId: string) {
    this.cancelled.push(projectId)
    return true
  }
}

class RejectingCancelLauncher implements ProjectRunLauncher {
  constructor(private readonly error: Error) {}

  async start() {
    return { runId: 'run-rejected-cancel' }
  }

  async cancel(): Promise<boolean> {
    throw this.error
  }
}

async function startServer(
  launcher?: ProjectRunLauncher,
  withRegistry = false,
) {
  const runRoot = mkdtempSync(join(tmpdir(), 'future-cup-server-'))
  roots.push(runRoot)
  const store = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
  const agentRegistry = withRegistry ? new PersistentAgentRegistry(store) : undefined
  const defaultTeamVersionId = agentRegistry === undefined
    ? undefined
    : await agentRegistry.ensureDefaultTeam()
  const errors: unknown[] = []
  const server = createFutureCupServer({
    store,
    agentRegistry,
    defaultTeamVersionId,
    profiles: defaultAgentProfiles(),
    host: '127.0.0.1',
    port: 0,
    outboxPollMs: 20,
    outboxBatchSize: 20,
    outboxClaimMs: 1_000,
    runRoot,
    getLauncher: () => launcher,
    onError: (error) => { errors.push(error) },
  })
  servers.push(server)
  const address = await server.start()
  return {
    server,
    store,
    agentRegistry,
    defaultTeamVersionId,
    errors,
    runRoot,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
  }
}

function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${name}`))
    }, 5_000)
    socket.once(name, (value: T) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

async function readJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const value: unknown = JSON.parse(await response.text())
  return schema.parse(value)
}

describe('Future Cup platform server', () => {
  it('serves project, agent, snapshot, run, and cancel APIs', async () => {
    const launcher = new FakeLauncher()
    const { baseUrl, store, errors, runRoot } = await startServer(launcher)
    const createdResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'project-api',
        name: 'API project',
        requirement: 'Build an admin dashboard',
      }),
    })
    expect(createdResponse.status).toBe(201)
    const projectId = ProjectId('project-api')
    const dag = await DagEngine.create(store, {
      id: projectId,
      name: 'API project',
      requirement: 'Build an admin dashboard',
    }, [
      taskDefinition({
        id: 'design',
        title: 'Design',
        description: 'Create the design system',
        role: 'ui-designer',
        priority: 50,
        dependencies: [],
        requiredCapabilities: { design: 1 },
        writeScopes: ['src/'],
      }),
    ])
    await dag.startTask(TaskId('design'), AgentId('ui-designer'))
    const executionId = store.startExecution(projectId, TaskId('design'), AgentId('ui-designer'))
    store.appendExecutionEvent(executionId, 'agent/started', { attempt: 1 })
    const completedExecutionId = store.startExecution(
      projectId,
      TaskId('planner'),
      AgentId('planner'),
    )
    store.finishExecution(completedExecutionId, 'COMPLETED', 'session-planner')
    const verification = store.saveVerificationReport(
      projectId,
      'PASS',
      { status: 'PASS' },
      TaskId('design'),
    )
    const repairRecord = store.saveRepairRecord(projectId, {
      repairRound: 1,
      verificationReportId: verification.id,
      repairAgentId: AgentId('repair'),
      failureSignature: 'signature',
      errorSummary: 'none',
      changeSummary: 'none',
      diff: '',
      beforeStatus: 'FAIL',
      afterStatus: 'PASS',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    })
    store.saveRepairStrategyDecision({
      id: 'repair-strategy-api',
      projectId,
      repairRound: 1,
      failureSignature: 'a'.repeat(64),
      strategyId: 'typescript-contract',
      decision: { selectedReason: 'TypeScript contract mismatch.' },
      outcome: { status: 'PASS', nextAction: 'COMPLETE' },
      repairRecordId: repairRecord.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    store.startWorkflowRun(projectId)
    store.updateWorkflowRun(projectId, 'PASSED', 1)
    const projectRun = store.createProjectRun(
      projectId,
      'test-worker',
      1n,
      join(runRoot, 'workspace'),
    )
    await Promise.resolve(store.appendProductEvent({
      projectId,
      type: 'task.created',
      taskId: 'task-1',
      payload: { title: 'Planner' },
    }))

    const [
      health,
      projects,
      agents,
      projectAgents,
      snapshot,
      tasks,
      task,
      decisions,
      executions,
      executionEvents,
      verificationReports,
      repairs,
      repairStrategies,
      workflow,
      runs,
      publicRun,
      delivery,
    ] = await Promise.all([
      fetch(`${baseUrl}/api/v1/health`).then(async response =>
        await readJson(response, healthSchema)),
      fetch(`${baseUrl}/api/v1/projects`).then(async response =>
        await readJson(response, z.array(projectSchema))),
      fetch(`${baseUrl}/api/v1/agents`).then(async response =>
        await readJson(response, z.array(agentSchema))),
      fetch(`${baseUrl}/api/v1/projects/project-api/agents`).then(async response =>
        await readJson(response, z.array(z.looseObject({
          id: z.string(),
          currentLoad: z.number(),
          historicalSuccessRate: z.number(),
          available: z.boolean(),
        })))),
      fetch(`${baseUrl}/api/v1/projects/project-api/snapshot?afterSeq=0&limit=500`)
        .then(async response => await readJson(response, snapshotSchema)),
      fetch(`${baseUrl}/api/v1/projects/project-api/tasks`)
        .then(async response => await readJson(response, z.array(z.looseObject({ id: z.string() })))),
      fetch(`${baseUrl}/api/v1/projects/project-api/tasks/design`)
        .then(async response => await readJson(response, z.looseObject({ id: z.string() }))),
      fetch(`${baseUrl}/api/v1/projects/project-api/scheduler-decisions`)
        .then(async response => await readJson(response, z.array(z.unknown()))),
      fetch(`${baseUrl}/api/v1/projects/project-api/executions`)
        .then(async response => await readJson(response, z.array(z.looseObject({ id: z.string() })))),
      fetch(`${baseUrl}/api/v1/projects/project-api/executions/${executionId}/events`)
        .then(async response => await readJson(response, z.array(z.looseObject({ seq: z.number() })))),
      fetch(`${baseUrl}/api/v1/projects/project-api/verification-reports`)
        .then(async response => await readJson(response, z.array(z.looseObject({ id: z.string() })))),
      fetch(`${baseUrl}/api/v1/projects/project-api/repairs`)
        .then(async response => await readJson(response, z.array(z.looseObject({ id: z.string() })))),
      fetch(`${baseUrl}/api/v1/projects/project-api/repair-strategies`)
        .then(async response => await readJson(response, z.array(z.looseObject({
          id: z.string(),
          strategyId: z.string(),
        })))),
      fetch(`${baseUrl}/api/v1/projects/project-api/workflow`)
        .then(async response => await readJson(response, z.looseObject({ status: z.string() }))),
      fetch(`${baseUrl}/api/v1/projects/project-api/runs`)
        .then(async response => await readJson(response, z.array(z.looseObject({
          id: z.string(),
          fencingToken: z.string(),
        })))),
      fetch(`${baseUrl}/api/v1/runs/${projectRun.id}`)
        .then(async response => await readJson(response, z.looseObject({
          id: z.string(),
          fencingToken: z.string(),
        }))),
      fetch(`${baseUrl}/api/v1/projects/project-api/delivery`)
        .then(async response => await readJson(response, z.looseObject({
          projectId: z.string(),
          runId: z.string(),
        }))),
    ])
    expect(health).toMatchObject({ status: 'ok', projects: 1 })
    expect(projects[0]).toMatchObject({ id: 'project-api' })
    expect(agents).toHaveLength(7)
    expect(projectAgents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ui-designer',
        currentLoad: 1,
        available: false,
      }),
      expect.objectContaining({
        id: 'planner',
        currentLoad: 0,
        historicalSuccessRate: 1,
        available: true,
      }),
    ]))
    expect(snapshot.events).toHaveLength(projects[0]?.lastEventSeq ?? 0)
    expect(snapshot.runs).toEqual([expect.objectContaining({
      id: projectRun.id,
      fencingToken: '1',
      hasWorkspace: true,
      hasPreview: false,
    })])
    expect(tasks).toEqual([expect.objectContaining({ id: 'design', status: 'RUNNING' })])
    expect(task).toMatchObject({ id: 'design', status: 'RUNNING' })
    expect(decisions).toEqual([])
    expect(executions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: executionId }),
      expect.objectContaining({ id: completedExecutionId, status: 'COMPLETED' }),
    ]))
    expect(executionEvents).toEqual([expect.objectContaining({ seq: 1 })])
    expect(verificationReports).toHaveLength(1)
    expect(repairs).toHaveLength(1)
    expect(repairStrategies).toEqual([
      expect.objectContaining({
        id: 'repair-strategy-api',
        strategyId: 'typescript-contract',
      }),
    ])
    expect(workflow).toMatchObject({ status: 'PASSED' })
    expect(runs).toEqual([expect.objectContaining({
      id: projectRun.id,
      fencingToken: '1',
    })])
    expect(publicRun).toMatchObject({ id: projectRun.id, fencingToken: '1' })
    expect(delivery).toMatchObject({
      projectId: 'project-api',
      runId: projectRun.id,
    })

    const run = await fetch(`${baseUrl}/api/v1/projects/project-api/runs`, { method: 'POST' })
    expect(run.status).toBe(202)
    expect(await run.json()).toEqual({ runId: 'run-project-api' })
    const cancel = await fetch(`${baseUrl}/api/v1/projects/project-api/cancel`, { method: 'POST' })
    expect(await cancel.json()).toEqual({ cancelled: true })
    expect(launcher.started).toEqual(['project-api'])
    expect(launcher.cancelled).toEqual(['project-api'])
    expect(errors).toEqual([])
  })

  it('registers versioned Agents and freezes the default team on project creation', async () => {
    const { baseUrl, agentRegistry, defaultTeamVersionId } = await startServer(undefined, true)
    expect(agentRegistry).toBeDefined()
    expect(defaultTeamVersionId).toBeDefined()

    const definitionResponse = await fetch(`${baseUrl}/api/v1/agent-definitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'accessibility-designer',
        name: 'Accessibility Designer',
        purpose: 'Define accessible interaction rules.',
        discoveryTags: ['design', 'accessibility'],
      }),
    })
    expect(definitionResponse.status).toBe(201)
    const contract = {
      id: 'future-cup.test-output',
      version: '1.0.0',
      dialect: JSON_SCHEMA_DIALECT,
      schema: {
        type: 'object',
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
    }
    const versionResponse = await fetch(
      `${baseUrl}/api/v1/agent-definitions/accessibility-designer/versions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'accessibility-designer-1.0.0',
          version: '1.0.0',
          role: 'ui-designer',
          model: 'deepseek-flash',
          prompt: 'Define accessible interaction rules.',
          promptVersion: 'v1',
          capabilities: { design: 0.9 },
          toolAllowlist: ['fs-read'],
          memoryPolicy: { access: 'READ', kinds: ['design-decision'] },
          maxConcurrency: 1,
          inputSchema: contract,
          outputSchema: contract,
        }),
      },
    )
    expect(versionResponse.status).toBe(201)
    expect((await fetch(
      `${baseUrl}/api/v1/agent-definitions/accessibility-designer/versions/accessibility-designer-1.0.0/validate`,
      { method: 'POST' },
    )).status).toBe(200)
    expect((await fetch(
      `${baseUrl}/api/v1/agent-definitions/accessibility-designer/versions/accessibility-designer-1.0.0/publish`,
      { method: 'POST' },
    )).status).toBe(200)

    const discovered = await fetch(`${baseUrl}/api/v1/agent-definitions/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability: 'design', minimumCapability: 0.8 }),
    }).then(async response => await readJson(response, z.array(z.looseObject({
      version: z.looseObject({ id: z.string() }),
    }))))
    expect(discovered.map(item => item.version.id)).toContain('accessibility-designer-1.0.0')

    const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'project-bound-team',
        name: 'Bound team',
        requirement: 'Build an admin page',
      }),
    })
    expect(projectResponse.status).toBe(201)
    const binding = await fetch(`${baseUrl}/api/v1/projects/project-bound-team/team`)
      .then(async response => await readJson(response, z.looseObject({
        teamVersion: z.looseObject({ id: z.string() }),
      })))
    expect(binding.teamVersion.id).toBe(defaultTeamVersionId)
    const projectAgents = await fetch(`${baseUrl}/api/v1/projects/project-bound-team/agents`)
      .then(async response => await readJson(response, z.array(agentSchema)))
    expect(projectAgents.map(agent => agent.id)).toEqual(expect.arrayContaining([
      'frontend-1',
      'frontend-2',
    ]))
  })

  it('recommends, adjusts, saves, and adopts a published Agent team', async () => {
    const { baseUrl, defaultTeamVersionId } = await startServer(undefined, true)
    const requirement = [
      '构建一个包含 2 个页面和 2 个独立模块的运营管理后台。',
      '使用 React、TypeScript、Vite 和 Ant Design，需要端到端测试。',
      '采用高质量验证、均衡预算，允许页面并行开发。',
    ].join('')
    const profileResponse = await fetch(`${baseUrl}/api/v1/team-recommendations/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requirement }),
    })
    expect(profileResponse.status).toBe(200)
    const structured = await readJson(profileResponse, structuredProjectProfileSchema)
    expect(structured.questions.length).toBeLessThanOrEqual(3)
    expect(structured.readyForRecommendation).toBe(true)

    const recommendationResponse = await fetch(`${baseUrl}/api/v1/team-recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requirement,
        profile: structured.profile,
        answers: [],
        adjustments: [],
      }),
    })
    expect(recommendationResponse.status).toBe(200)
    const recommendation = await readJson(recommendationResponse, teamRecommendationPlanSchema)
    expect(recommendation.readyForRecommendation).toBe(true)
    expect(recommendation.recommendation?.missingCapabilities).toEqual([])
    expect(recommendation.recommendation?.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'planner', instanceCount: 1 }),
      expect.objectContaining({ role: 'frontend', instanceCount: 2 }),
      expect.objectContaining({ role: 'integration', instanceCount: 1 }),
    ]))

    const adjustmentResponse = await fetch(`${baseUrl}/api/v1/team-recommendations/adjust`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requirement,
        profile: structured.profile,
        answers: [],
        adjustments: ['降低并发到 2'],
      }),
    })
    expect(adjustmentResponse.status).toBe(200)
    const adjusted = await readJson(adjustmentResponse, teamRecommendationPlanSchema)
    expect(adjusted.adjustments).toHaveLength(1)
    expect(adjusted.adjustments[0]?.intent.type).toBe('reduce-concurrency')

    const saveResponse = await fetch(`${baseUrl}/api/v1/team-recommendations/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requirement,
        profile: structured.profile,
        answers: [],
        adjustments: ['降低并发到 2'],
        teamName: 'operations-team',
      }),
    })
    expect(saveResponse.status).toBe(201)
    const saved = await readJson(saveResponse, teamRecommendationSaveResponseSchema)
    expect(saved.teamVersion).toMatchObject({
      name: 'operations-team',
      version: '1.0.0',
    })
    expect(saved.teamVersion.id).not.toBe(defaultTeamVersionId)

    const adoptResponse = await fetch(`${baseUrl}/api/v1/team-recommendations/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requirement,
        profile: structured.profile,
        answers: [],
        adjustments: ['降低并发到 2'],
        projectName: 'recommended-operations-project',
      }),
    })
    expect(adoptResponse.status).toBe(201)
    const adopted = await readJson(adoptResponse, teamRecommendationAdoptionResponseSchema)
    expect(adopted.teamVersion.name).toBe('recommended-operations-project')
    const binding = await fetch(
      `${baseUrl}/api/v1/projects/${encodeURIComponent(adopted.projectId)}/team`,
    ).then(async response => await readJson(response, z.looseObject({
      teamVersion: z.looseObject({ id: z.string() }),
    })))
    expect(binding.teamVersion.id).toBe(adopted.teamVersion.id)
  })

  it('returns explicit validation, duplicate, missing-resource, and unavailable-run errors', async () => {
    const { baseUrl } = await startServer()
    const create = (body: unknown) => fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const invalid = await create({ name: '', requirement: '' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' })

    expect((await create({
      id: 'project-errors',
      name: 'Errors',
      requirement: 'Validate errors',
    })).status).toBe(201)
    const duplicate = await create({
      id: 'project-errors',
      name: 'Errors',
      requirement: 'Validate errors',
    })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({ code: 'PROJECT_EXISTS' })

    expect((await fetch(`${baseUrl}/api/v1/projects/missing/snapshot`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/api/v1/projects/project-errors/tasks/missing`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/api/v1/projects/project-errors/workflow`)).status).toBe(404)
    const unavailable = await fetch(`${baseUrl}/api/v1/projects/project-errors/runs`, {
      method: 'POST',
    })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ code: 'RUN_LAUNCHER_UNAVAILABLE' })
    expect((await fetch(`${baseUrl}/api/v1/projects/missing/cancel`, { method: 'POST' })).status)
      .toBe(404)
  })

  it('maps settlement pending and timeout failures to 503 and 504', async () => {
    const createProject = async (baseUrl: string, projectId: string) => {
      const response = await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: projectId,
          requirement: 'Test settlement errors',
        }),
      })
      expect(response.status).toBe(201)
    }

    const pending = await startServer(new RejectingCancelLauncher(
      new ProjectRunSettlementPendingError([{
        projectId: 'project-pending',
        runId: 'run-pending',
        code: 'PROJECT_RUN_NOT_FOUND',
        message: 'settlement pending',
        retryable: false,
        occurredAt: new Date().toISOString(),
      }]),
    ))
    await createProject(pending.baseUrl, 'project-pending')
    const pendingResponse = await fetch(
      `${pending.baseUrl}/api/v1/projects/project-pending/cancel`,
      { method: 'POST' },
    )
    expect(pendingResponse.status).toBe(503)
    expect(await pendingResponse.json()).toMatchObject({
      code: 'PROJECT_RUN_SETTLEMENT_PENDING',
    })

    const timeout = await startServer(new RejectingCancelLauncher(
      new ProjectRunSettlementTimeoutError(['project-timeout']),
    ))
    await createProject(timeout.baseUrl, 'project-timeout')
    const timeoutResponse = await fetch(
      `${timeout.baseUrl}/api/v1/projects/project-timeout/cancel`,
      { method: 'POST' },
    )
    expect(timeoutResponse.status).toBe(504)
    expect(await timeoutResponse.json()).toMatchObject({
      code: 'PROJECT_RUN_SETTLEMENT_TIMEOUT',
    })
  })

  it('replays from afterSeq, then sends committed Outbox events live', async () => {
    const { baseUrl, store } = await startServer()
    const projectId = ProjectId('project-stream')
    store.createProject({
      id: projectId,
      name: 'Stream',
      requirement: 'Observe events',
      createdAt: new Date().toISOString(),
    }, [])
    await Promise.resolve(store.appendProductEvent({
      projectId,
      type: 'task.created',
      taskId: 'task-1',
      payload: { sequence: 1 },
    }))
    const initialClaims = await Promise.resolve(store.claimOutbox('test-setup', 10, 1_000))
    store.markOutboxPublished('test-setup', initialClaims.map(claim => claim.eventId))

    const socket = connectSocket(baseUrl, {
      path: '/future-cup/socket.io',
      transports: ['websocket'],
      reconnection: false,
      auth: { projectId, afterSeq: 0 },
    })
    sockets.push(socket)
    const snapshot = await event<{ events: Array<{ seq: number }> }>(socket, 'sync.snapshot')
    expect(snapshot.events.map(item => item.seq)).toEqual([1])

    const livePromise = event<{ seq: number }>(socket, 'project.event')
    await Promise.resolve(store.appendProductEvent({
      projectId,
      type: 'agent.started',
      taskId: 'task-1',
      agentId: 'planner',
      payload: { attempt: 1 },
    }))
    expect((await livePromise).seq).toBe(2)
    socket.disconnect()

    await Promise.resolve(store.appendProductEvent({
      projectId,
      type: 'agent.completed',
      taskId: 'task-1',
      agentId: 'planner',
      payload: { attempt: 1 },
    }))
    const reconnected = connectSocket(baseUrl, {
      path: '/future-cup/socket.io',
      transports: ['websocket'],
      reconnection: false,
      auth: { projectId, afterSeq: 2 },
    })
    sockets.push(reconnected)
    const replay = await event<{ events: Array<{ seq: number }> }>(reconnected, 'sync.snapshot')
    expect(replay.events.map(item => item.seq)).toEqual([3])
  })

  it('rejects an invalid Socket.IO resume cursor without loading a snapshot', async () => {
    const { baseUrl } = await startServer()
    const socket = connectSocket(baseUrl, {
      path: '/future-cup/socket.io',
      transports: ['websocket'],
      reconnection: false,
      auth: { projectId: 'project-stream', afterSeq: -1 },
    })
    sockets.push(socket)
    await expect(event<{ code: string }>(socket, 'sync.error'))
      .resolves.toMatchObject({ code: 'INVALID_CURSOR' })
  })
})
