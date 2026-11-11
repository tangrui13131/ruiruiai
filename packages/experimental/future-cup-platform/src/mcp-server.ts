/** Model Context Protocol (MCP) server for the Future Cup platform. */

import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createMcpHandler,
  LATEST_PROTOCOL_VERSION,
  McpServer,
  ResourceTemplate,
  type CallToolResult,
} from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from '@modelcontextprotocol/node'
import { z } from 'zod'
import type {
  PlatformProjectSummary,
  ProjectMemoryEntry,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  mcpServerInfoResponseSchema,
  publicAgentTeamVersionSchema,
  savedAgentTeamVersionSchema,
  teamRecommendationAdoptRequestSchema,
  teamRecommendationRequestSchema,
} from './api-contracts.ts'
import type {
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpServerInfoResponse,
  McpToolDescriptor,
  PublicProjectSnapshot,
  TeamRecommendationPlan,
} from './api-contracts.ts'

/** Supported MCP protocol revision advertised by the Future Cup platform. */
export const FUTURE_CUP_MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION

/** Canonical HTTP path where the MCP Streamable HTTP transport is mounted. */
export const FUTURE_CUP_MCP_ENDPOINT_PATH = '/api/v1/mcp'

/** HTTP path for the browser-facing MCP capability descriptor. */
export const FUTURE_CUP_MCP_INFO_PATH = `${FUTURE_CUP_MCP_ENDPOINT_PATH}/info`

const MCP_SERVER_NAME = 'future-cup-platform-mcp'
const MCP_SERVER_VERSION = '1.0.0'

const mcpCreateProjectInputSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(120),
  requirement: z.string().min(1).max(20_000),
  teamVersionId: z.string().min(1).max(160).optional(),
}).strict()

const mcpProjectIdInputSchema = z.object({
  projectId: z.string().min(1).max(120),
}).strict()

const mcpDeriveProjectInputSchema = z.object({
  sourceProjectId: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  mode: z.enum(['UPGRADE', 'REGENERATE']),
  changeRequest: z.string().trim().max(20_000).optional(),
}).strict()

const delegatePromptInputSchema = z.object({
  requirement: z.string().trim().min(1).max(4_000),
  projectName: z.string().trim().min(1).max(120).optional(),
}).strict()

const upgradePromptInputSchema = z.object({
  sourceProjectId: z.string().min(1).max(120),
  changeRequest: z.string().trim().min(1).max(4_000),
}).strict()

/** Domain callbacks delegated from the Future Cup platform server to MCP tools. */
export interface FutureCupMcpOperations {
  /** Build a deterministic Agent team recommendation from a requirement and optional answers. */
  recommendTeam(
    input: z.infer<typeof teamRecommendationRequestSchema>,
  ): Promise<TeamRecommendationPlan>
  /** Save a recommended team version and create a bound project in one step. */
  adoptAndCreateProject(
    input: z.infer<typeof teamRecommendationAdoptRequestSchema>,
  ): Promise<{
    readonly projectId: string
    readonly teamVersion: z.infer<typeof savedAgentTeamVersionSchema>
  }>
  /** Create a new project bound to a published or default Agent team version. */
  createProject(
    input: z.infer<typeof mcpCreateProjectInputSchema>,
  ): Promise<PlatformProjectSummary>
  /** Launch an asynchronous multi-Agent DAG execution run for a project. */
  startRun(projectId: string): Promise<{ readonly runId: string }>
  /** Request cancellation of an active project run. */
  cancelRun(projectId: string): Promise<{ readonly cancelled: boolean }>
  /** Load the sanitized public snapshot for a project. */
  getProjectSnapshot(projectId: string): Promise<PublicProjectSnapshot>
  /** Load the durable structured memory entries for a project. */
  listProjectMemory(projectId: string): Promise<readonly ProjectMemoryEntry[]>
  /** Create and start a derived successor project from a passed source project. */
  deriveProject(
    sourceProjectId: string,
    input: {
      readonly name: string
      readonly mode: 'UPGRADE' | 'REGENERATE'
      readonly changeRequest?: string | undefined
    },
  ): Promise<{ readonly project: PlatformProjectSummary; readonly runId: string }>
  /** List all durable projects in the platform store. */
  listProjects(): Promise<readonly PlatformProjectSummary[]>
  /** List all published Agent team versions accessible to the current profile. */
  listPublishedTeams(): Promise<readonly z.infer<typeof publicAgentTeamVersionSchema>[]>
}

/** One MCP transport runtime backed by the official SDK. */
export interface FutureCupMcpRuntime {
  /**
   * Serve one Fastify-carried HTTP request through Streamable HTTP.
   * @param request - raw Node request.
   * @param response - raw Node response.
   * @param body - Fastify's route-scoped body, buffered for MCP routes.
   */
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    body: unknown,
  ): Promise<void>
  /** Close all in-flight MCP exchanges. */
  close(): Promise<void>
}

const MCP_TOOL_DEFINITIONS = {
  recommendTeam: {
    name: 'future_cup_recommend_team',
    description: 'Analyze a frontend engineering requirement and recommend a validated 1-7 Agent team with capability coverage and clarification questions.',
    inputSchema: z.toJSONSchema(teamRecommendationRequestSchema),
  },
  adoptAndCreateProject: {
    name: 'future_cup_adopt_and_create_project',
    description: 'Save a recommended Agent team as an immutable published version and create a bound frontend project.',
    inputSchema: z.toJSONSchema(teamRecommendationAdoptRequestSchema),
  },
  createProject: {
    name: 'future_cup_create_project',
    description: 'Create a frontend engineering project bound to the default 7-Agent team or a specified published teamVersionId.',
    inputSchema: z.toJSONSchema(mcpCreateProjectInputSchema),
  },
  startRun: {
    name: 'future_cup_start_run',
    description: 'Start the multi-Agent DAG execution, real browser verification, and bounded self-healing loop for a project.',
    inputSchema: z.toJSONSchema(mcpProjectIdInputSchema),
  },
  projectStatus: {
    name: 'future_cup_get_project_status',
    description: 'Query real-time DAG task states, Agent load, workflow control graph state, and latest run status for a project.',
    inputSchema: z.toJSONSchema(mcpProjectIdInputSchema),
  },
  verificationAndRepairs: {
    name: 'future_cup_get_verification_and_repairs',
    description: 'Retrieve independent TypeScript/Vite/Playwright verification reports, adaptive self-loop strategy decisions, and repair diffs.',
    inputSchema: z.toJSONSchema(mcpProjectIdInputSchema),
  },
  deriveProject: {
    name: 'future_cup_derive_project',
    description: 'Create and launch a successor project (UPGRADE over verified snapshot or REGENERATE) from a passed project.',
    inputSchema: z.toJSONSchema(mcpDeriveProjectInputSchema),
  },
  cancelRun: {
    name: 'future_cup_cancel_run',
    description: 'Cancel an active project run and release its workflow lease.',
    inputSchema: z.toJSONSchema(mcpProjectIdInputSchema),
  },
} satisfies Record<string, McpToolDescriptor>
const MCP_TOOLS: readonly McpToolDescriptor[] = Object.values(MCP_TOOL_DEFINITIONS)

const MCP_RESOURCE_DEFINITIONS = {
  projects: {
    uri: 'future-cup://projects',
    name: 'Future Cup Projects Catalog',
    description: 'All frontend engineering projects, latest run statuses, event sequences, and derivation lineage.',
    mimeType: 'application/json',
    isTemplate: false,
  },
  publishedTeams: {
    uri: 'future-cup://teams/published',
    name: 'Published Agent Team Templates',
    description: 'Immutable published Agent team versions with role composition and concurrency capacity.',
    mimeType: 'application/json',
    isTemplate: false,
  },
  projectMemory: {
    uri: 'future-cup://projects/{projectId}/memory',
    name: 'Project Structured Memory',
    description: 'Structured project memory entries (requirements, design decisions, failure signatures, accepted artifacts).',
    mimeType: 'application/json',
    isTemplate: true,
  },
  latestVerification: {
    uri: 'future-cup://projects/{projectId}/verification-latest',
    name: 'Latest Verification Evidence',
    description: 'Latest independent Verifier report (TypeScript, Vite build, desktop/mobile Playwright checks, screenshots).',
    mimeType: 'application/json',
    isTemplate: true,
  },
} satisfies Record<string, McpResourceDescriptor>
const MCP_RESOURCES: readonly McpResourceDescriptor[] = Object.values(MCP_RESOURCE_DEFINITIONS)

const MCP_PROMPT_DEFINITIONS = {
  delegateFrontendProject: {
    name: 'delegate-frontend-project',
    description: 'Recommend a specialized Agent team, create a frozen project, launch DAG execution, and inspect verification evidence.',
    arguments: [
      {
        name: 'requirement',
        description: 'Frontend engineering requirement to delegate to the Future Cup platform.',
        required: true,
      },
      {
        name: 'projectName',
        description: 'Optional display name for the created project.',
        required: false,
      },
    ],
  },
  upgradeVerifiedProject: {
    name: 'upgrade-verified-project',
    description: 'Inspect structured memory of a passed project and launch an incremental UPGRADE successor.',
    arguments: [
      {
        name: 'sourceProjectId',
        description: 'Identifier of the passed source project.',
        required: true,
      },
      {
        name: 'changeRequest',
        description: 'Incremental feature or UI changes to apply on top of the verified snapshot.',
        required: true,
      },
    ],
  },
} satisfies Record<string, McpPromptDescriptor>
const MCP_PROMPTS: readonly McpPromptDescriptor[] = Object.values(MCP_PROMPT_DEFINITIONS)

/**
 * Return the browser-facing descriptor for the Future Cup MCP server.
 * @returns validated server metadata, tool schemas, resources, and prompts.
 */
export function getFutureCupMcpServerInfo(): McpServerInfoResponse {
  return mcpServerInfoResponseSchema.parse({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    protocolVersion: FUTURE_CUP_MCP_PROTOCOL_VERSION,
    endpointPath: FUTURE_CUP_MCP_ENDPOINT_PATH,
    tools: MCP_TOOLS,
    resources: MCP_RESOURCES,
    prompts: MCP_PROMPTS,
  })
}

/**
 * Build the protocol server registered with the official MCP SDK.
 * @param operations - platform callbacks backing tools and resources.
 * @returns a fresh MCP server for one SDK serving unit.
 */
export function createFutureCupMcpServer(
  operations: FutureCupMcpOperations,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions: [
        'Use Future Cup tools to recommend or create a frontend project, start its Agent run,',
        'and inspect project status, verification evidence, and repairs before reporting success.',
      ].join(' '),
    },
  )

  registerTools(server, operations)
  registerResources(server, operations)
  registerPrompts(server)
  return server
}

/**
 * Create the Streamable HTTP transport with loopback request guards.
 * @param operations - platform callbacks used by every per-request MCP server.
 * @param onError - optional out-of-band transport reporting hook.
 * @returns a runtime that serves raw Node requests and owns SDK cleanup.
 */
export function createFutureCupMcpRuntime(
  operations: FutureCupMcpOperations,
  onError?: (error: unknown) => void,
): FutureCupMcpRuntime {
  const handler = createMcpHandler(
    () => createFutureCupMcpServer(operations),
    {
      legacy: 'stateless',
      ...(onError === undefined ? {} : { onerror: onError }),
    },
  )
  const handleNodeRequest = toNodeHandler(
    handler,
    onError === undefined ? undefined : { onerror: onError },
  )
  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()

  return {
    async handleRequest(request, response, body) {
      if (!validateHost(request, response)) return
      if (!validateOrigin(request, response)) return

      const parsedBody = request.method?.toUpperCase() === 'POST'
        ? parseMcpRequestBody(body)
        : { ok: true, value: undefined } as const
      if (!parsedBody.ok) {
        sendJsonRpcParseError(response)
        return
      }
      const compatibleRequest = request as IncomingMessage & NodeIncomingMessageLike
      await handleNodeRequest(compatibleRequest, response, parsedBody.value)
    },
    async close() {
      await handler.close()
    },
  }
}

function registerTools(
  server: McpServer,
  operations: FutureCupMcpOperations,
): void {
  server.registerTool(
    'future_cup_recommend_team',
    {
      description: MCP_TOOL_DEFINITIONS.recommendTeam.description,
      inputSchema: teamRecommendationRequestSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => await runTool(async () => {
      const plan = await operations.recommendTeam(args)
      return { ...plan }
    }),
  )

  server.registerTool(
    'future_cup_adopt_and_create_project',
    {
      description: MCP_TOOL_DEFINITIONS.adoptAndCreateProject.description,
      inputSchema: teamRecommendationAdoptRequestSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async args => await runTool(async () => {
      const adopted = await operations.adoptAndCreateProject(args)
      return {
        ...adopted,
        ...projectPortalLinks(adopted.projectId),
      }
    }),
  )

  server.registerTool(
    'future_cup_create_project',
    {
      description: MCP_TOOL_DEFINITIONS.createProject.description,
      inputSchema: mcpCreateProjectInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async args => await runTool(async () => {
      const project = await operations.createProject(args)
      return {
        project,
        ...projectPortalLinks(project.id),
      }
    }),
  )

  server.registerTool(
    'future_cup_start_run',
    {
      description: MCP_TOOL_DEFINITIONS.startRun.description,
      inputSchema: mcpProjectIdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ projectId }) => await runTool(async () => {
      const started = await operations.startRun(projectId)
      return {
        projectId,
        runId: started.runId,
        status: 'RUNNING',
        ...projectPortalLinks(projectId),
      }
    }),
  )

  server.registerTool(
    'future_cup_get_project_status',
    {
      description: MCP_TOOL_DEFINITIONS.projectStatus.description,
      inputSchema: mcpProjectIdInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ projectId }) => await runTool(async () => {
      const snapshot = await operations.getProjectSnapshot(projectId)
      const latestRun = snapshot.runs.at(-1) ?? null
      return {
        project: snapshot.project,
        latestRun,
        lastEventSeq: snapshot.project.lastEventSeq,
        taskCount: snapshot.tasks.length,
        tasks: snapshot.tasks.map(task => ({
          id: task.id,
          title: task.title,
          role: task.role,
          status: task.status,
          assignedAgentId: task.assignedAgentId ?? null,
          retryCount: task.retryCount,
        })),
        workflow: snapshot.workflow ?? null,
        latestVerificationStatus: snapshot.verificationReports.at(-1)?.status ?? null,
        repairCount: snapshot.repairs.length,
        ...projectPortalLinks(projectId),
      }
    }),
  )

  server.registerTool(
    'future_cup_get_verification_and_repairs',
    {
      description: MCP_TOOL_DEFINITIONS.verificationAndRepairs.description,
      inputSchema: mcpProjectIdInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ projectId }) => await runTool(async () => {
      const snapshot = await operations.getProjectSnapshot(projectId)
      const latestRun = snapshot.runs.at(-1)
      return {
        projectId,
        latestRunStatus: latestRun?.status ?? null,
        hasPreview: latestRun?.hasPreview ?? false,
        previewPath: latestRun?.hasPreview === true
          ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(latestRun.id)}/preview/`
          : null,
        verificationReports: snapshot.verificationReports,
        repairs: snapshot.repairs,
        repairStrategies: snapshot.repairStrategies,
      }
    }),
  )

  server.registerTool(
    'future_cup_derive_project',
    {
      description: MCP_TOOL_DEFINITIONS.deriveProject.description,
      inputSchema: mcpDeriveProjectInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async args => await runTool(async () => {
      const derived = await operations.deriveProject(args.sourceProjectId, {
        name: args.name,
        mode: args.mode,
        ...(args.changeRequest === undefined ? {} : { changeRequest: args.changeRequest }),
      })
      return {
        project: derived.project,
        runId: derived.runId,
        ...projectPortalLinks(derived.project.id),
      }
    }),
  )

  server.registerTool(
    'future_cup_cancel_run',
    {
      description: MCP_TOOL_DEFINITIONS.cancelRun.description,
      inputSchema: mcpProjectIdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ projectId }) => await runTool(async () => {
      const result = await operations.cancelRun(projectId)
      return {
        projectId,
        cancelled: result.cancelled,
      }
    }),
  )
}

function registerResources(
  server: McpServer,
  operations: FutureCupMcpOperations,
): void {
  server.registerResource(
    'future-cup-projects',
    MCP_RESOURCE_DEFINITIONS.projects.uri,
    {
      description: MCP_RESOURCE_DEFINITIONS.projects.description,
      mimeType: MCP_RESOURCE_DEFINITIONS.projects.mimeType,
    },
    async uri => resourceResult(uri.href, await operations.listProjects()),
  )
  server.registerResource(
    'future-cup-published-teams',
    MCP_RESOURCE_DEFINITIONS.publishedTeams.uri,
    {
      description: MCP_RESOURCE_DEFINITIONS.publishedTeams.description,
      mimeType: MCP_RESOURCE_DEFINITIONS.publishedTeams.mimeType,
    },
    async uri => resourceResult(uri.href, await operations.listPublishedTeams()),
  )
  server.registerResource(
    'future-cup-project-memory',
    new ResourceTemplate(MCP_RESOURCE_DEFINITIONS.projectMemory.uri, { list: undefined }),
    {
      description: MCP_RESOURCE_DEFINITIONS.projectMemory.description,
      mimeType: MCP_RESOURCE_DEFINITIONS.projectMemory.mimeType,
    },
    async (uri, variables) => {
      const projectId = stringVariable(variables.projectId)
      return resourceResult(uri.href, {
        projectId,
        memoryEntries: await operations.listProjectMemory(projectId),
      })
    },
  )
  server.registerResource(
    'future-cup-latest-verification',
    new ResourceTemplate(MCP_RESOURCE_DEFINITIONS.latestVerification.uri, { list: undefined }),
    {
      description: MCP_RESOURCE_DEFINITIONS.latestVerification.description,
      mimeType: MCP_RESOURCE_DEFINITIONS.latestVerification.mimeType,
    },
    async (uri, variables) => {
      const projectId = stringVariable(variables.projectId)
      const snapshot = await operations.getProjectSnapshot(projectId)
      return resourceResult(uri.href, {
        projectId,
        latestRun: snapshot.runs.at(-1) ?? null,
        latestVerificationReport: snapshot.verificationReports.at(-1) ?? null,
      })
    },
  )
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    MCP_PROMPT_DEFINITIONS.delegateFrontendProject.name,
    {
      description: MCP_PROMPT_DEFINITIONS.delegateFrontendProject.description,
      argsSchema: delegatePromptInputSchema,
    },
    ({ requirement, projectName }) => ({
      description: 'Delegate a frontend engineering project to the Future Cup multi-Agent team.',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Please build and verify the following React/TypeScript/Vite/Ant Design project using the Future Cup MCP tools:',
            `Project Name: ${projectName ?? 'Future Cup Frontend App'}`,
            `Requirement: ${requirement}`,
            'Steps:',
            '1. Call future_cup_recommend_team to inspect the recommended Agent team and any clarification questions.',
            '2. Call future_cup_adopt_and_create_project to freeze the team and create the project.',
            '3. Call future_cup_start_run to start the multi-Agent DAG execution and browser verification.',
            '4. Poll future_cup_get_project_status and future_cup_get_verification_and_repairs to report the Playwright verification evidence and HQ live screen URL.',
          ].join('\n'),
        },
      }],
    }),
  )

  server.registerPrompt(
    MCP_PROMPT_DEFINITIONS.upgradeVerifiedProject.name,
    {
      description: MCP_PROMPT_DEFINITIONS.upgradeVerifiedProject.description,
      argsSchema: upgradePromptInputSchema,
    },
    ({ sourceProjectId, changeRequest }) => ({
      description: 'Upgrade a verified Future Cup project with incremental changes.',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Please upgrade verified project "${sourceProjectId}" using the Future Cup MCP tools:`,
            `Change Request: ${changeRequest}`,
            'Steps:',
            `1. Read resource future-cup://projects/${encodeURIComponent(sourceProjectId)}/memory to review existing design decisions.`,
            '2. Call future_cup_derive_project with mode="UPGRADE" and the changeRequest.',
            '3. Monitor the new run with future_cup_get_project_status until verification passes.',
          ].join('\n'),
        },
      }],
    }),
  )
}

async function runTool(
  execute: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const payload = await execute()
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      isError: false,
    }
  } catch (error: unknown) {
    const payload = formatToolError(error)
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      isError: true,
    }
  }
}

function resourceResult(
  uri: string,
  payload: unknown,
) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2),
    }],
  }
}

function stringVariable(value: unknown): string {
  return String(value)
}

function projectPortalLinks(projectId: string): {
  readonly managementPath: string
  readonly hqPath: string
} {
  const encoded = encodeURIComponent(projectId)
  return {
    managementPath: `/#/projects/${encoded}`,
    hqPath: `/hq/index.html?projectId=${encoded}`,
  }
}

function formatToolError(error: unknown): { readonly code: string; readonly message: string } {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    return {
      code: error.code,
      message: error.message,
    }
  }
  if (error instanceof Error) {
    return {
      code: 'EXECUTION_ERROR',
      message: error.message,
    }
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: String(error),
  }
}

function parseMcpRequestBody(
  body: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (!Buffer.isBuffer(body)) return { ok: false }
  const text = body.toString('utf8')
  if (text.trim() === '') return { ok: false }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function sendJsonRpcParseError(response: ServerResponse): void {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32700,
      message: 'Parse error',
    },
  })
  response.writeHead(400, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}
