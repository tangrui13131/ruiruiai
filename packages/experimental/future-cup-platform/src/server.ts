/** Fastify REST snapshots and Socket.IO project-event delivery. */

import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { Server as SocketServer } from 'socket.io'
import { z } from 'zod'
import {
  agentDiscoveryQuerySchema,
  AgentRegistryError,
  ProjectId,
  projectReplayCursorSchema,
  createAgentTeamVersionInputSchema,
  registerAgentDefinitionInputSchema,
  registerAgentVersionInputSchema,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type {
  PlatformProjectSnapshot,
  PlatformProjectSummary,
  ProductEvent,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  publicProjectRun,
  publicProjectSnapshot,
  publicVerificationReport,
  projectRunStartSchema,
} from './api-contracts.ts'
import { registerFutureCupArtifacts } from './artifact-server.ts'
import {
  ProjectRunConflictError,
  ProjectRunStartError,
} from './run-launcher.ts'
import type {
  FutureCupServer,
  FutureCupServerOptions,
  ProjectRunLauncher,
} from './server-types.ts'

const projectParamsSchema = z.object({
  projectId: z.string().min(1).max(120),
}).strict()

const taskParamsSchema = projectParamsSchema.extend({
  taskId: z.string().min(1).max(120),
}).strict()

const executionParamsSchema = projectParamsSchema.extend({
  executionId: z.string().min(1).max(160),
}).strict()

const runParamsSchema = z.object({
  runId: z.string().min(1).max(160),
}).strict()

const definitionParamsSchema = z.object({
  definitionId: z.string().min(1).max(160),
}).strict()

const versionParamsSchema = definitionParamsSchema.extend({
  versionId: z.string().min(1).max(200),
}).strict()

const teamParamsSchema = z.object({
  teamVersionId: z.string().min(1).max(200),
}).strict()

const snapshotQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(100),
}).strict()

const createProjectSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(120),
  requirement: z.string().min(1).max(20_000),
  teamVersionId: z.string().min(1).max(160).optional(),
}).strict()

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Create the Future Cup REST and realtime server without binding a port.
 * @param options - explicit transport, storage, profile, and Outbox configuration.
 * @returns a server with quiescent start and close operations.
 */
export function createFutureCupServer(options: FutureCupServerOptions): FutureCupServer {
  assertServerOptions(options)
  const app = Fastify({ logger: false })
  const io = new SocketServer(app.server, {
    path: '/future-cup/socket.io',
    serveClient: false,
  })
  let pollTimer: NodeJS.Timeout | undefined
  let polling = false
  let closed = false
  const outboxOwnerId = `future-cup-dispatcher-${randomUUID()}`

  app.setErrorHandler((error, _request, reply) => {
    if (isApiError(error)) {
      void reply.code(error.statusCode).send({ code: error.code, message: error.message })
      return
    }
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: error.message,
        issues: error.issues,
      })
      return
    }
    options.onError?.(error)
    void reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error' })
  })

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    projects: (await options.store.listProjects()).length,
  }))

  app.get('/api/v1/projects', async () => await options.store.listProjects())

  app.post<{ Body: unknown }>('/api/v1/projects', async (request, reply) => {
    const body = createProjectSchema.parse(request.body)
    const projectId = ProjectId(body.id ?? `project-${randomUUID()}`)
    if ((await options.store.listProjects()).some(project => project.id === projectId)) {
      throw new ApiError(409, 'PROJECT_EXISTS', `Project "${projectId}" already exists`)
    }
    const teamVersionId = body.teamVersionId ?? options.defaultTeamVersionId
    try {
      const binding = teamVersionId === undefined
        ? undefined
        : await requireAgentRegistry().freezeProject(projectId, teamVersionId)
      const createdAt = new Date().toISOString()
      await options.store.createProject({
        id: projectId,
        name: body.name,
        requirement: body.requirement,
        createdAt,
      }, [], undefined, binding, [{
        id: `memory-${randomUUID()}`,
        projectId,
        kind: 'requirement',
        key: 'initial-requirement',
        value: { requirement: body.requirement },
        source: 'platform.project.create',
        createdAt,
      }])
    } catch (error: unknown) {
      if (error instanceof AgentRegistryError) {
        throw new ApiError(
          error.code === 'TEAM_VERSION_NOT_FOUND' ? 404 : 400,
          error.code,
          error.message,
        )
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new ApiError(409, 'PROJECT_EXISTS', `Project "${projectId}" already exists`)
      }
      throw error
    }
    const created = (await options.store.listProjects()).find(project => project.id === projectId)
    if (created === undefined) throw new Error(`created project "${projectId}" disappeared`)
    return await reply.code(201).send(created)
  })

  app.get<{ Params: unknown; Querystring: unknown }>(
    '/api/v1/projects/:projectId/snapshot',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const query = snapshotQuerySchema.parse(request.query)
      const snapshot = await options.store.getProjectSnapshot(projectId, query.afterSeq, query.limit)
      if (snapshot === undefined) throw new ApiError(404, 'PROJECT_NOT_FOUND', `Project "${projectId}" was not found`)
      return await reply.send(publicProjectSnapshot(snapshot))
    },
  )

  app.get<{ Params: unknown }>('/api/v1/projects/:projectId/tasks', async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params)
    const snapshot = await requireSnapshot(projectId)
    return await reply.send(snapshot.tasks)
  })

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/tasks/:taskId',
    async (request, reply) => {
      const { projectId, taskId } = taskParamsSchema.parse(request.params)
      const snapshot = await requireSnapshot(projectId)
      const task = snapshot.tasks.find(value => value.id === taskId)
      if (task === undefined) {
        throw new ApiError(404, 'TASK_NOT_FOUND', `Task "${taskId}" was not found`)
      }
      return await reply.send(task)
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/scheduler-decisions',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      return await reply.send((await requireSnapshot(projectId)).decisions)
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/executions',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      return await reply.send((await requireSnapshot(projectId)).executions)
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/executions/:executionId/events',
    async (request, reply) => {
      const { projectId, executionId } = executionParamsSchema.parse(request.params)
      const snapshot = await requireSnapshot(projectId)
      if (!snapshot.executions.some(execution => execution.id === executionId)) {
        throw new ApiError(404, 'EXECUTION_NOT_FOUND', `Execution "${executionId}" was not found`)
      }
      return await reply.send(await options.store.listExecutionEvents(executionId))
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/verification-reports',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      return await reply.send(
        (await requireSnapshot(projectId)).verificationReports.map(publicVerificationReport),
      )
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/repairs',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      return await reply.send((await requireSnapshot(projectId)).repairs)
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/workflow',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const workflow = (await requireSnapshot(projectId)).workflow
      if (workflow === undefined) {
        throw new ApiError(404, 'WORKFLOW_NOT_FOUND', `Workflow for project "${projectId}" was not found`)
      }
      return await reply.send(workflow)
    },
  )

  app.get<{ Params: unknown; Querystring: unknown }>(
    '/api/v1/projects/:projectId/events',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const query = snapshotQuerySchema.parse(request.query)
      const project = (await options.store.listProjects()).find(value => value.id === projectId)
      if (project === undefined) throw new ApiError(404, 'PROJECT_NOT_FOUND', `Project "${projectId}" was not found`)
      return await reply.send({
        projectId,
        lastEventSeq: project.lastEventSeq,
        events: await options.store.listProductEvents(projectId, query.afterSeq, query.limit),
      })
    },
  )

  app.get('/api/v1/agents', () => options.profiles.map(profile => ({
    id: profile.id,
    name: profile.name,
    role: profile.role,
    capabilities: profile.capabilities,
    maxConcurrency: profile.maxConcurrency,
    currentLoad: profile.currentLoad,
    historicalSuccessRate: profile.historicalSuccessRate,
    available: profile.available,
  })))

  app.get('/api/v1/agent-definitions', async () => {
    const registry = requireAgentRegistry()
    const definitions = await registry.listDefinitions()
    return await Promise.all(definitions.map(async (definition) => {
      const versions = await registry.listVersions(definition.id)
      return {
        ...definition,
        versions: await Promise.all(versions.map(async version => ({
          ...version,
          status: await registry.getVersionStatus(version.id),
        }))),
      }
    }))
  })

  app.post<{ Body: unknown }>('/api/v1/agent-definitions', async (request, reply) => {
    const input = registerAgentDefinitionInputSchema.parse(request.body)
    return await reply.code(201).send(
      await registryCall(() => requireAgentRegistry().registerDefinition(input)),
    )
  })

  app.post<{ Body: unknown }>('/api/v1/agent-definitions/discover', async (request) => {
    const query = agentDiscoveryQuerySchema.parse(request.body)
    return await requireAgentRegistry().discoverPublished(query)
  })

  app.post<{ Params: unknown; Body: unknown }>(
    '/api/v1/agent-definitions/:definitionId/versions',
    async (request, reply) => {
      const { definitionId } = definitionParamsSchema.parse(request.params)
      const input = registerAgentVersionInputSchema.parse(request.body)
      return await reply.code(201).send(
        await registryCall(() => requireAgentRegistry().registerVersion(definitionId, input)),
      )
    },
  )

  app.post<{ Params: unknown }>(
    '/api/v1/agent-definitions/:definitionId/versions/:versionId/validate',
    async (request) => {
      const { definitionId, versionId } = versionParamsSchema.parse(request.params)
      return await registryCall(
        () => requireAgentRegistry().validateVersion(definitionId, versionId),
      )
    },
  )

  app.post<{ Params: unknown }>(
    '/api/v1/agent-definitions/:definitionId/versions/:versionId/publish',
    async (request) => {
      const { definitionId, versionId } = versionParamsSchema.parse(request.params)
      return await registryCall(
        () => requireAgentRegistry().publishVersion(definitionId, versionId),
      )
    },
  )

  app.post<{ Params: unknown }>(
    '/api/v1/agent-definitions/:definitionId/deprecate',
    async (request) => {
      const { definitionId } = definitionParamsSchema.parse(request.params)
      return await registryCall(
        () => requireAgentRegistry().deprecateDefinition(definitionId),
      )
    },
  )

  app.post<{ Body: unknown }>('/api/v1/agent-teams', async (request, reply) => {
    const input = createAgentTeamVersionInputSchema.parse(request.body)
    return await reply.code(201).send(
      await registryCall(() => requireAgentRegistry().createTeamVersion(input)),
    )
  })

  app.get('/api/v1/agent-teams', async () => {
    return (await options.store.listAgentTeamVersions()).map(record => record.teamVersion)
  })

  app.get<{ Params: unknown }>('/api/v1/agent-teams/:teamVersionId', async (request, reply) => {
    const { teamVersionId } = teamParamsSchema.parse(request.params)
    const team = await options.store.getAgentTeamVersion(teamVersionId)
    if (team === undefined) {
      throw new ApiError(404, 'TEAM_VERSION_NOT_FOUND', `Agent team version "${teamVersionId}" was not found`)
    }
    return await reply.send(team.teamVersion)
  })

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/agents',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const snapshot = await requireSnapshot(projectId)
      const rates = await options.store.historicalSuccessRates(projectId)
      const boundProfiles = options.agentRegistry === undefined
        ? undefined
        : await options.agentRegistry.projectProfiles(projectId)
      const profiles = boundProfiles ?? options.profiles
      const loads = new Map<string, number>()
      for (const execution of snapshot.executions) {
        if (execution.status !== 'RUNNING') continue
        loads.set(execution.agentId, (loads.get(execution.agentId) ?? 0) + 1)
      }
      return await reply.send(profiles.map((profile) => {
        const currentLoad = loads.get(profile.id) ?? 0
        return {
          id: profile.id,
          name: profile.name,
          role: profile.role,
          capabilities: profile.capabilities,
          maxConcurrency: profile.maxConcurrency,
          currentLoad,
          historicalSuccessRate: rates[profile.id] ?? profile.historicalSuccessRate,
          available: profile.available && currentLoad < profile.maxConcurrency,
          definitionVersionId: profile.definitionVersionId,
          model: profile.model,
          toolAllowlist: profile.toolAllowlist,
        }
      }))
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/team',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      await requireProject(projectId)
      const binding = await options.store.getProjectTeamBinding(projectId)
      if (binding === undefined) {
        throw new ApiError(404, 'TEAM_BINDING_NOT_FOUND', `Project "${projectId}" has no team binding`)
      }
      return await reply.send(binding)
    },
  )

  app.post<{ Params: unknown; Body: unknown }>(
    '/api/v1/projects/:projectId/team-binding',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const body = z.object({ teamVersionId: z.string().min(1).max(200) }).strict().parse(request.body)
      await requireProject(projectId)
      const binding = await registryCall(
        () => requireAgentRegistry().bindProject(projectId, body.teamVersionId),
      )
      return await reply.code(201).send(binding)
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/workflow-control',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      await requireProject(projectId)
      const state = await options.store.getWorkflowControlState(projectId)
      if (state === undefined) {
        throw new ApiError(404, 'WORKFLOW_CONTROL_NOT_FOUND', `Workflow control for "${projectId}" was not found`)
      }
      return await reply.send(state)
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/workflow-control/events',
    async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      await requireProject(projectId)
      return await options.store.listWorkflowControlEvents(projectId)
    },
  )

  app.get<{ Params: unknown }>('/api/v1/projects/:projectId/runs', async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params)
    await requireProject(projectId)
    return await reply.send((await options.store.listProjectRuns(projectId)).map(publicProjectRun))
  })

  app.get<{ Params: unknown }>('/api/v1/runs/:runId', async (request, reply) => {
    const { runId } = runParamsSchema.parse(request.params)
    const run = await options.store.getProjectRun(runId)
    if (run === undefined) throw new ApiError(404, 'RUN_NOT_FOUND', `Run "${runId}" was not found`)
    return await reply.send(publicProjectRun(run))
  })

  app.post<{ Params: unknown }>('/api/v1/projects/:projectId/runs', async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params)
    try {
      const result = await requireLauncher().start(await requireProject(projectId))
      return await reply.code(202).send(projectRunStartSchema.parse(result))
    } catch (error: unknown) {
      if (error instanceof ProjectRunConflictError) {
        throw new ApiError(409, error.code, error.message)
      }
      if (error instanceof ProjectRunStartError) {
        throw new ApiError(503, error.code, error.message)
      }
      throw error
    }
  })

  app.post<{ Params: unknown }>('/api/v1/projects/:projectId/cancel', async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params)
    await requireProject(projectId)
    return await reply.send({ cancelled: await requireLauncher().cancel(projectId) })
  })

  async function requireSnapshot(projectId: string): Promise<PlatformProjectSnapshot> {
    const snapshot = await options.store.getProjectSnapshot(projectId, 0, 1)
    if (snapshot === undefined) {
      throw new ApiError(404, 'PROJECT_NOT_FOUND', `Project "${projectId}" was not found`)
    }
    return snapshot
  }

  async function requireProject(projectId: string): Promise<PlatformProjectSummary> {
    const project = (await options.store.listProjects()).find(value => value.id === projectId)
    if (project === undefined) {
      throw new ApiError(404, 'PROJECT_NOT_FOUND', `Project "${projectId}" was not found`)
    }
    return project
  }

  function requireLauncher(): ProjectRunLauncher {
    const launcher = options.getLauncher?.()
    if (launcher === undefined) {
      throw new ApiError(503, 'RUN_LAUNCHER_UNAVAILABLE', 'No project run launcher is mounted')
    }
    return launcher
  }

  function requireAgentRegistry() {
    if (options.agentRegistry === undefined) {
      throw new ApiError(503, 'AGENT_REGISTRY_UNAVAILABLE', 'No Agent Registry is mounted')
    }
    return options.agentRegistry
  }

  async function registryCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      if (!(error instanceof AgentRegistryError)) throw error
      const status = error.code === 'DEFINITION_NOT_FOUND'
        || error.code === 'VERSION_NOT_FOUND'
        || error.code === 'TEAM_VERSION_NOT_FOUND'
        ? 404
        : error.code === 'PROJECT_ALREADY_BOUND'
          || error.code === 'DUPLICATE_DEFINITION'
          || error.code === 'DUPLICATE_VERSION'
          || error.code === 'DUPLICATE_VERSION_NUMBER'
          || error.code === 'DUPLICATE_TEAM_VERSION'
          ? 409
          : 400
      throw new ApiError(status, error.code, error.message)
    }
  }

  io.on('connection', (socket) => {
    const parsed = projectReplayCursorSchema.safeParse(socket.handshake.auth)
    if (!parsed.success) {
      socket.emit('sync.error', { code: 'INVALID_CURSOR', message: parsed.error.message })
      socket.disconnect(true)
      return
    }
    const room = roomFor(parsed.data.projectId)
    void (async () => {
      await socket.join(room)
      try {
        const snapshot = await options.store.getProjectSnapshot(
          parsed.data.projectId,
          parsed.data.afterSeq,
          500,
        )
        if (snapshot === undefined) {
          socket.emit('sync.error', {
            code: 'PROJECT_NOT_FOUND',
            message: `Project "${parsed.data.projectId}" was not found`,
          })
          socket.disconnect(true)
          return
        }
        socket.emit('sync.snapshot', publicProjectSnapshot(snapshot))
      } catch (error: unknown) {
        options.onError?.(error)
        socket.emit('sync.error', { code: 'SNAPSHOT_FAILED', message: 'Snapshot load failed' })
        socket.disconnect(true)
      }
    })()
  })

  async function pollOutbox(): Promise<void> {
    if (polling || closed) return
    polling = true
    try {
      const claims = await options.store.claimOutbox(
        outboxOwnerId,
        options.outboxBatchSize,
        options.outboxClaimMs,
      )
      for (const claim of claims) {
        io.to(roomFor(claim.event.projectId)).emit('project.event', claim.event)
      }
      await options.store.markOutboxPublished(
        outboxOwnerId,
        claims.map(claim => claim.eventId),
      )
    } catch (error: unknown) {
      options.onError?.(error)
    } finally {
      polling = false
    }
  }

  registerFutureCupArtifacts(app, {
    store: options.store,
    runRoot: options.runRoot,
    uiRoot: options.uiRoot,
  })

  return {
    async start() {
      if (closed) throw new Error('Future Cup server is closed')
      await app.listen({ host: options.host, port: options.port })
      const address = app.server.address() as AddressInfo
      pollTimer = setInterval(() => {
        void pollOutbox()
      }, options.outboxPollMs)
      pollTimer.unref()
      await pollOutbox()
      return { host: address.address, port: address.port }
    },
    async close() {
      if (closed) return
      closed = true
      if (pollTimer !== undefined) clearInterval(pollTimer)
      const errors: unknown[] = []
      try {
        await io.close()
      } catch (error: unknown) {
        errors.push(error)
      }
      try {
        await app.close()
      } catch (error: unknown) {
        errors.push(error)
      }
      try {
        await options.store.close()
      } catch (error: unknown) {
        errors.push(error)
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Future Cup server cleanup failed')
      }
    },
  }
}

function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError || (
    typeof error === 'object'
    && error !== null
    && 'statusCode' in error
    && typeof error.statusCode === 'number'
    && Number.isInteger(error.statusCode)
    && error.statusCode >= 400
    && error.statusCode <= 599
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string'
  )
}

function assertServerOptions(options: FutureCupServerOptions): void {
  if (options.host !== '127.0.0.1' && options.host !== '::1') {
    throw new Error('Future Cup M4 server requires a loopback host')
  }
  for (const [name, value] of [
    ['port', options.port],
    ['outboxPollMs', options.outboxPollMs],
    ['outboxBatchSize', options.outboxBatchSize],
    ['outboxClaimMs', options.outboxClaimMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || (name !== 'port' && value === 0)) {
      throw new Error(`${name} must be a valid positive integer`)
    }
  }
  if (options.runRoot.trim() === '') throw new Error('runRoot must not be empty')
  if (options.uiRoot !== undefined && options.uiRoot.trim() === '') {
    throw new Error('uiRoot must not be empty')
  }
}

function roomFor(projectId: string): string {
  return `future-cup:project:${projectId}`
}

export type { PlatformProjectSnapshot, ProductEvent }
