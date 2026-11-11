import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
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
  taskDefinition,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type { PlatformProjectSummary } from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mcpServerInfoResponseSchema } from '../src/api-contracts.ts'
import {
  FUTURE_CUP_MCP_ENDPOINT_PATH,
  FUTURE_CUP_MCP_INFO_PATH,
  FUTURE_CUP_MCP_PROTOCOL_VERSION,
  createFutureCupMcpRuntime,
  getFutureCupMcpServerInfo,
} from '../src/mcp-server.ts'
import type { FutureCupMcpOperations } from '../src/mcp-server.ts'
import { createFutureCupServer } from '../src/server.ts'
import type { FutureCupServer, ProjectRunLauncher } from '../src/server-types.ts'

const servers: FutureCupServer[] = []
const clients: Client[] = []
const roots: string[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
  for (const server of servers.splice(0)) await server.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

class FakeMcpLauncher implements ProjectRunLauncher {
  readonly started: string[] = []
  readonly cancelled: string[] = []
  failure: unknown

  async start(project: PlatformProjectSummary) {
    if (this.failure !== undefined) throw this.failure
    this.started.push(project.id)
    return { runId: `run-${project.id}` }
  }

  async cancel(projectId: string) {
    if (this.failure !== undefined) throw this.failure
    this.cancelled.push(projectId)
    return true
  }
}

async function startMcpTestServer() {
  const runRoot = mkdtempSync(join(tmpdir(), 'future-cup-mcp-'))
  roots.push(runRoot)
  const store = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
  const agentRegistry = new PersistentAgentRegistry(store)
  const defaultTeamVersionId = await agentRegistry.ensureDefaultTeam()
  const launcher = new FakeMcpLauncher()
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
  })
  servers.push(server)
  const address = await server.start()
  const origin = `http://127.0.0.1:${String(address.port)}`
  return {
    store,
    launcher,
    origin,
    runRoot,
    mcpUrl: `${origin}${FUTURE_CUP_MCP_ENDPOINT_PATH}`,
    infoUrl: `${origin}${FUTURE_CUP_MCP_INFO_PATH}`,
  }
}

async function connectMcpClient(mcpUrl: string): Promise<Client> {
  const client = new Client({ name: 'future-cup-protocol-test', version: '1.0.0' })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)))
  return client
}

async function postJsonRpc(
  mcpUrl: string,
  payload: unknown,
): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': FUTURE_CUP_MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify(payload),
  })
  return {
    status: response.status,
    body: await response.text(),
    headers: response.headers,
  }
}

async function rawHttpRequest(
  url: string,
  headers: Record<string, string>,
  body = '',
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...headers,
      },
    }, (response) => {
      const chunks: Uint8Array[] = []
      response.on('data', (chunk: Uint8Array) => { chunks.push(chunk) })
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

function structured(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.structuredContent
  if (content === undefined || typeof content !== 'object' || content === null) {
    throw new Error(`expected structured tool content, got ${JSON.stringify(result)}`)
  }
  return content as Record<string, unknown>
}

function resourceText(result: Awaited<ReturnType<Client['readResource']>>): string {
  const first = result.contents[0]
  if (first === undefined || !('text' in first) || typeof first.text !== 'string') {
    throw new Error(`expected text resource content, got ${JSON.stringify(result)}`)
  }
  return first.text
}

function unusedMcpOperations(): FutureCupMcpOperations {
  const unused = async (): Promise<never> => {
    throw new Error('unused MCP operation')
  }
  return {
    recommendTeam: unused,
    adoptAndCreateProject: unused,
    createProject: unused,
    startRun: unused,
    cancelRun: unused,
    getProjectSnapshot: unused,
    listProjectMemory: unused,
    deriveProject: unused,
    listProjects: unused,
    listPublishedTeams: unused,
  }
}

describe('Future Cup MCP protocol contract', () => {
  it('serves a separate browser descriptor and the latest official protocol revision', async () => {
    const { infoUrl } = await startMcpTestServer()
    const response = await fetch(infoUrl)
    expect(response.status).toBe(200)
    const info = mcpServerInfoResponseSchema.parse(await response.json())
    expect(info).toEqual(getFutureCupMcpServerInfo())
    expect(info.protocolVersion).toBe(FUTURE_CUP_MCP_PROTOCOL_VERSION)
    expect(info.endpointPath).toBe(FUTURE_CUP_MCP_ENDPOINT_PATH)
    expect(info.tools.map(tool => tool.name)).toEqual([
      'future_cup_recommend_team',
      'future_cup_adopt_and_create_project',
      'future_cup_create_project',
      'future_cup_start_run',
      'future_cup_get_project_status',
      'future_cup_get_verification_and_repairs',
      'future_cup_derive_project',
      'future_cup_cancel_run',
    ])
  })

  it('negotiates and discovers tools, resources, templates, and prompts through the official client', async () => {
    const { mcpUrl } = await startMcpTestServer()
    const client = await connectMcpClient(mcpUrl)

    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name)).toHaveLength(8)
    expect(tools.tools[0]?.inputSchema).toMatchObject({ type: 'object' })

    const resources = await client.listResources()
    expect(resources.resources.map(resource => resource.uri)).toEqual([
      'future-cup://projects',
      'future-cup://teams/published',
    ])

    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates.map(template => template.uriTemplate)).toEqual([
      'future-cup://projects/{projectId}/memory',
      'future-cup://projects/{projectId}/verification-latest',
    ])

    const prompts = await client.listPrompts()
    expect(prompts.prompts.map(prompt => prompt.name)).toEqual([
      'delegate-frontend-project',
      'upgrade-verified-project',
    ])
  })

  it('does not reply to JSON-RPC notifications and protects the loopback endpoint', async () => {
    const { mcpUrl, origin } = await startMcpTestServer()
    const initialize = await postJsonRpc(mcpUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: FUTURE_CUP_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'raw-protocol-test', version: '1.0.0' },
      },
    })
    expect(initialize.status).toBe(200)
    expect(initialize.body).toContain(FUTURE_CUP_MCP_PROTOCOL_VERSION)

    const notification = await postJsonRpc(mcpUrl, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(notification.status).toBe(202)
    expect(notification.body).toBe('')

    const invalidHost = await rawHttpRequest(mcpUrl, {
      host: 'attacker.example',
    }, '{}')
    expect(invalidHost.status).toBe(403)
    expect(invalidHost.body).toContain('Invalid Host')

    const invalidOrigin = await rawHttpRequest(mcpUrl, {
      host: new URL(origin).host,
      origin: 'https://attacker.example',
    }, '{}')
    expect(invalidOrigin.status).toBe(403)
    expect(invalidOrigin.body).toContain('Invalid Origin')
  })

  it('returns JSON-RPC parse errors for malformed and empty POST bodies', async () => {
    const { mcpUrl } = await startMcpTestServer()
    for (const body of ['', '{bad json']) {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body,
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700 },
      })
    }
  })

  it('rejects a missing route body before SDK dispatch and accepts an error reporter', async () => {
    const runtime = createFutureCupMcpRuntime(unusedMcpOperations(), () => undefined)
    const server = createServer((request, response) => {
      void runtime.handleRequest(request, response, undefined)
    })
    const listening: PromiseWithResolvers<void> = Promise.withResolvers()
    server.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('MCP runtime has no TCP address')

    try {
      const response = await fetch(`http://127.0.0.1:${String(address.port)}${FUTURE_CUP_MCP_ENDPOINT_PATH}`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: '{}',
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: { code: -32700 } })
    } finally {
      await runtime.close()
      const closed: PromiseWithResolvers<void> = Promise.withResolvers()
      server.close((error) => {
        if (error === undefined) closed.resolve()
        else closed.reject(error)
      })
      await closed.promise
    }
  })

  it('rejects unsupported HTTP methods with an explicit Allow header', async () => {
    const { mcpUrl } = await startMcpTestServer()
    const response = await fetch(mcpUrl, { method: 'PUT' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST, DELETE')
  })

  it('runs the complete MCP tool, resource, and prompt lifecycle', async () => {
    const { mcpUrl, store, launcher, runRoot } = await startMcpTestServer()
    const client = await connectMcpClient(mcpUrl)
    const requirement = 'Build a 2-page SaaS analytics dashboard with 2 parallel modules and high quality testing'

    const recommendation = await client.callTool({
      name: 'future_cup_recommend_team',
      arguments: {
        requirement,
        answers: [
          { type: 'page-count', count: 2 },
          { type: 'module-parallelism', moduleCount: 2, parallelism: 'parallel' },
          { type: 'quality-verification', level: 'high' },
        ],
      },
    })
    expect(recommendation.isError).toBe(false)
    expect(structured(recommendation)).toMatchObject({ readyForRecommendation: true })

    const adopted = await client.callTool({
      name: 'future_cup_adopt_and_create_project',
      arguments: {
        projectName: 'Analytics Pro',
        requirement,
        answers: [
          { type: 'page-count', count: 2 },
          { type: 'module-parallelism', moduleCount: 2, parallelism: 'parallel' },
          { type: 'quality-verification', level: 'high' },
        ],
      },
    })
    expect(adopted.isError).toBe(false)
    expect(structured(adopted).projectId).toBeTruthy()

    const created = await client.callTool({
      name: 'future_cup_create_project',
      arguments: {
        id: 'project-mcp-direct',
        name: 'Direct MCP Project',
        requirement: 'Build an operations portal',
      },
    })
    expect(created.isError).toBe(false)

    const autoId = await client.callTool({
      name: 'future_cup_create_project',
      arguments: {
        name: 'Auto ID MCP Project',
        requirement: 'Build a clean portal',
      },
    })
    expect(autoId.isError).toBe(false)

    const started = await client.callTool({
      name: 'future_cup_start_run',
      arguments: { projectId: 'project-mcp-direct' },
    })
    expect(started.isError).toBe(false)
    expect(structured(started)).toMatchObject({
      projectId: 'project-mcp-direct',
      runId: 'run-project-mcp-direct',
      status: 'RUNNING',
    })
    expect(launcher.started).toContain('project-mcp-direct')

    const cancelled = await client.callTool({
      name: 'future_cup_cancel_run',
      arguments: { projectId: 'project-mcp-direct' },
    })
    expect(structured(cancelled)).toEqual({
      projectId: 'project-mcp-direct',
      cancelled: true,
    })

    const emptyStatus = await client.callTool({
      name: 'future_cup_get_project_status',
      arguments: { projectId: 'project-mcp-direct' },
    })
    expect(structured(emptyStatus)).toMatchObject({
      latestRun: null,
      latestVerificationStatus: null,
      taskCount: 0,
    })

    const emptyVerification = await client.callTool({
      name: 'future_cup_get_verification_and_repairs',
      arguments: { projectId: 'project-mcp-direct' },
    })
    expect(structured(emptyVerification)).toMatchObject({
      latestRunStatus: null,
      hasPreview: false,
      previewPath: null,
    })

    const emptyVerificationResource = await client.readResource({
      uri: 'future-cup://projects/project-mcp-direct/verification-latest',
    })
    expect(JSON.parse(resourceText(emptyVerificationResource)) as Record<string, unknown>).toEqual({
      projectId: 'project-mcp-direct',
      latestRun: null,
      latestVerificationReport: null,
    })

    const projectId = ProjectId('project-mcp-direct')
    const dag = await DagEngine.create(store, {
      id: projectId,
      name: 'Direct MCP Project',
      requirement: 'Build an operations portal',
    }, [
      taskDefinition({
        id: 'task-ui',
        title: 'Design UI',
        description: 'Create design system',
        role: 'ui-designer',
        priority: 50,
        dependencies: [],
        requiredCapabilities: { design: 0.8 },
        writeScopes: ['src/'],
      }),
      taskDefinition({
        id: 'task-fe',
        title: 'Build frontend',
        description: 'Build pages',
        role: 'frontend',
        priority: 50,
        dependencies: ['task-ui'],
        requiredCapabilities: { frontend: 0.8 },
        writeScopes: ['src/'],
      }),
    ])
    await dag.startTask(TaskId('task-ui'), AgentId('agent-ui-1'))

    const sourceWorkspace = join(runRoot, 'mcp-source-workspace')
    mkdirSync(join(sourceWorkspace, 'src'), { recursive: true })
    writeFileSync(join(sourceWorkspace, 'src', 'App.tsx'), 'export const App = () => <main>MCP v1</main>\n')
    const runRecord = store.createProjectRun(projectId, 'mcp-worker', 1n, sourceWorkspace)
    store.finishProjectRun(runRecord.id, 'PASSED', join(sourceWorkspace, 'dist'))
    store.saveVerificationReport(projectId, 'PASS', {
      verifier: 'future-cup-m3',
      status: 'PASS',
      failureSignature: null,
      checks: [],
      findings: [],
      routes: ['/'],
      viewports: ['desktop'],
      screenshots: [],
    })

    const populatedStatus = await client.callTool({
      name: 'future_cup_get_project_status',
      arguments: { projectId: 'project-mcp-direct' },
    })
    expect(structured(populatedStatus)).toMatchObject({
      taskCount: 2,
      latestVerificationStatus: 'PASS',
      tasks: [
        { id: 'task-ui', assignedAgentId: 'agent-ui-1' },
        { id: 'task-fe', assignedAgentId: null },
      ],
    })

    const populatedVerification = await client.callTool({
      name: 'future_cup_get_verification_and_repairs',
      arguments: { projectId: 'project-mcp-direct' },
    })
    expect(structured(populatedVerification)).toMatchObject({
      latestRunStatus: 'PASSED',
      hasPreview: true,
      previewPath: `/projects/project-mcp-direct/runs/${runRecord.id}/preview/`,
    })

    const projectsResource = await client.readResource({ uri: 'future-cup://projects' })
    expect((JSON.parse(resourceText(projectsResource)) as { id: string }[]).length).toBeGreaterThanOrEqual(3)
    const teamsResource = await client.readResource({ uri: 'future-cup://teams/published' })
    expect((JSON.parse(resourceText(teamsResource)) as { id: string }[]).length).toBeGreaterThanOrEqual(1)
    const memoryResource = await client.readResource({
      uri: 'future-cup://projects/project-mcp-direct/memory',
    })
    expect(JSON.parse(resourceText(memoryResource)) as Record<string, unknown>).toMatchObject({
      projectId: 'project-mcp-direct',
    })
    const verificationResource = await client.readResource({
      uri: 'future-cup://projects/project-mcp-direct/verification-latest',
    })
    expect(JSON.parse(resourceText(verificationResource)) as Record<string, unknown>).toMatchObject({
      projectId: 'project-mcp-direct',
      latestVerificationReport: { status: 'PASS' },
    })

    const upgraded = await client.callTool({
      name: 'future_cup_derive_project',
      arguments: {
        sourceProjectId: 'project-mcp-direct',
        name: 'Direct MCP Project v2',
        mode: 'UPGRADE',
        changeRequest: 'Add dark mode toggle',
      },
    })
    expect(structured(upgraded)).toMatchObject({
      project: {
        sourceProjectId: 'project-mcp-direct',
        derivationMode: 'UPGRADE',
        changeRequest: 'Add dark mode toggle',
      },
    })

    const regenerated = await client.callTool({
      name: 'future_cup_derive_project',
      arguments: {
        sourceProjectId: 'project-mcp-direct',
        name: 'Direct MCP Project Regen',
        mode: 'REGENERATE',
      },
    })
    expect(regenerated.isError).toBe(false)

    const delegatePrompt = await client.getPrompt({
      name: 'delegate-frontend-project',
      arguments: { requirement: 'Build a CRM dashboard' },
    })
    expect(JSON.stringify(delegatePrompt)).toContain('Future Cup Frontend App')
    const namedDelegatePrompt = await client.getPrompt({
      name: 'delegate-frontend-project',
      arguments: { requirement: 'Build a CRM dashboard', projectName: 'CRM Suite' },
    })
    expect(JSON.stringify(namedDelegatePrompt)).toContain('CRM Suite')
    const upgradePrompt = await client.getPrompt({
      name: 'upgrade-verified-project',
      arguments: {
        sourceProjectId: 'project-mcp-direct',
        changeRequest: 'Add export button',
      },
    })
    expect(JSON.stringify(upgradePrompt)).toContain('project-mcp-direct')
  })

  it('returns protocol-level tool errors with structured codes', async () => {
    const { mcpUrl, launcher } = await startMcpTestServer()
    const client = await connectMcpClient(mcpUrl)

    const missingProject = await client.callTool({
      name: 'future_cup_start_run',
      arguments: { projectId: 'does-not-exist' },
    })
    expect(missingProject.isError).toBe(true)
    expect(structured(missingProject)).toMatchObject({ code: 'PROJECT_NOT_FOUND' })

    const created = await client.callTool({
      name: 'future_cup_create_project',
      arguments: {
        id: 'project-mcp-error',
        name: 'MCP Error Project',
        requirement: 'Build an error path',
      },
    })
    expect(created.isError).toBe(false)

    launcher.failure = new Error('plain failure')
    const genericFailure = await client.callTool({
      name: 'future_cup_start_run',
      arguments: { projectId: 'project-mcp-error' },
    })
    expect(structured(genericFailure)).toEqual({
      code: 'EXECUTION_ERROR',
      message: 'plain failure',
    })

    launcher.failure = 'string failure'
    const unknownFailure = await client.callTool({
      name: 'future_cup_start_run',
      arguments: { projectId: 'project-mcp-error' },
    })
    expect(structured(unknownFailure)).toEqual({
      code: 'UNKNOWN_ERROR',
      message: 'string failure',
    })
  })
})
