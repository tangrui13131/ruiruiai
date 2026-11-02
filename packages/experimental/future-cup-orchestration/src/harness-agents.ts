/** Real DeepSeek Harness TypeScript SDK adapters for each Future Cup Agent role. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ReasoningEffortId as ReasoningEffort } from '@deepseek-ai/dsh-llm'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { z } from 'zod'
import type { AgentInvocation, AgentInvoker, AgentRun } from './agent-contracts.ts'
import { parseStructuredOutput } from './agent-contracts.ts'
import { AgentId } from './brand.ts'
import type { AgentProfile } from './types.ts'

const BASE_ARTIFACT_PATCH = `
- id: persistent-bash
  disabled: true

- id: persistent-pwsh
  disabled: true
`

const SUPPORTED_AGENT_TOOLS = new Set(['fs-read'])

/** Inputs shared by all real Harness Agent adapters. */
export interface HarnessAgentOptions {
  /** Shared generated-project workspace. */
  readonly workspace: string
  /** Root containing one disposable DSH home per Agent. */
  readonly homeRoot: string
  /** DeepSeek provider route. */
  readonly provider?: string
  /** Model used by every role. */
  readonly model?: string
  /** Maximum output tokens per Agent request. */
  readonly maxTokens?: number
  /** Adapter-owned reasoning effort; structured-output tasks default to `off`. */
  readonly reasoningEffort?: ReasoningEffort
  /** Request timeout for one Agent turn. */
  readonly requestTimeoutMs?: number
}

/**
 * The fixed M3 Agent team. Planner, UI Designer, Tester, Integration, and Repair each have one instance;
 * frontend capability is intentionally duplicated for parallel load splitting.
 * @returns independent Agent profiles with capability and capacity metadata.
 */
export function defaultAgentProfiles(): AgentProfile[] {
  const common = {
    maxConcurrency: 1,
    currentLoad: 0,
    historicalSuccessRate: 0.75,
    available: true,
  } as const
  return [
    {
      ...common,
      id: AgentId('planner'),
      name: 'Planner',
      role: 'planner',
      capabilities: { planning: 1 },
    },
    {
      ...common,
      id: AgentId('ui-designer'),
      name: 'UI Designer',
      role: 'ui-designer',
      capabilities: { design: 1 },
    },
    {
      ...common,
      id: AgentId('tester'),
      name: 'Tester',
      role: 'tester',
      capabilities: { testing: 1 },
    },
    {
      ...common,
      id: AgentId('frontend-a'),
      name: 'Frontend Agent A',
      role: 'frontend',
      capabilities: { frontend: 1 },
    },
    {
      ...common,
      id: AgentId('frontend-b'),
      name: 'Frontend Agent B',
      role: 'frontend',
      capabilities: { frontend: 1 },
    },
    {
      ...common,
      id: AgentId('integration'),
      name: 'Integration Agent',
      role: 'integration',
      capabilities: { integration: 1 },
    },
    {
      ...common,
      id: AgentId('repair'),
      name: 'Repair Agent',
      role: 'repair',
      capabilities: { repair: 1 },
    },
  ]
}

/** One real Harness runtime and structured-output adapter for one Agent role. */
export class HarnessAgentInvoker implements AgentInvoker {
  private readonly harness: DeepSeekHarness
  private closed = false

  /**
   * @param profile - exact Agent capability and identity.
   * @param options - shared workspace, model, and isolated Harness home root.
   */
  constructor(readonly profile: AgentProfile, options: HarnessAgentOptions) {
    const dshHome = resolve(options.homeRoot, safePathSegment(profile.id))
    mkdirSync(dshHome, { recursive: true })
    const patchPath = resolve(dshHome, 'artifact-only.cordis.patch.yml')
    writeFileSync(patchPath, artifactOnlyPatch(profile), { encoding: 'utf8', mode: 0o600 })
    this.harness = new DeepSeekHarness({
      profile: 'sdk-minimal',
      patches: [patchPath],
      dshHome,
      cwd: resolve(options.workspace),
      processCwd: resolve(options.workspace),
      env: {
        ...process.env,
        DSH_TELEMETRY_DISABLED: '1',
      },
      provider: options.provider ?? 'deepseek-official',
      model: profile.model ?? options.model ?? 'deepseek-flash',
      reasoningEffort: options.reasoningEffort ?? ReasoningEffortId('off'),
      maxTokens: options.maxTokens ?? 32_000,
      initializeTimeoutMs: 30_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 600_000,
    })
  }

  /**
   * Run one independent Harness Session and validate its structured response.
   * @param invocation - task identity and complete prompt.
   * @param schema - task-owned output validator.
   * @returns validated output, Session identity, and committed event types.
   */
  async run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    if (this.closed) throw new Error(`Agent "${this.profile.id}" is closed`)
    const result = await this.harness.run(invocation.prompt)
    return {
      sessionId: result.sessionId,
      output: parseStructuredOutput(result.finalResponse, schema),
      eventTypes: result.events.map(event => event.type),
    }
  }

  /** Close the Agent-owned Harness runtime. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.harness.close()
  }
}

function artifactOnlyPatch(profile: AgentProfile): string {
  const tools = profile.toolAllowlist ?? ['fs-read']
  const unsupported = tools.filter(tool => !SUPPORTED_AGENT_TOOLS.has(tool))
  if (unsupported.length > 0) {
    throw new Error(
      `Agent "${profile.id}" requests unsupported tools: ${unsupported.join(', ')}`,
    )
  }
  const read = tools.includes('fs-read')
  return `${BASE_ARTIFACT_PATCH}
- id: tool-fs
  config:
    read: ${String(read)}
    readImage: ${String(read)}
    write: false
    edit: false
`
}

/**
 * Create one real Harness invoker per configured Agent profile.
 * @param profiles - Agent team profiles.
 * @param options - shared model and workspace settings.
 * @returns invokers keyed by Agent id.
 */
export function createHarnessAgentTeam(
  profiles: readonly AgentProfile[],
  options: HarnessAgentOptions,
): Map<string, AgentInvoker> {
  return new Map(profiles.map(profile => [
    profile.id,
    new HarnessAgentInvoker(profile, options),
  ]))
}

/**
 * Resolve one invoker and fail loudly for an incomplete team.
 * @param invokers - runtime invokers keyed by Agent id.
 * @param agentId - requested Agent.
 * @returns the matching invoker.
 */
export function requireAgentInvoker(
  invokers: ReadonlyMap<string, AgentInvoker>,
  agentId: string,
): AgentInvoker {
  const invoker = invokers.get(agentId)
  if (invoker === undefined) throw new Error(`Agent invoker "${agentId}" is not configured`)
  return invoker
}

function safePathSegment(segment: string): string {
  return segment.replace(/[:*?"<>|\\]/g, '_')
}
