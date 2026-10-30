/** Structured Agent invocation contracts and deterministic JSON response parsing. */

import { z } from 'zod'
import type { AgentProfile } from './types.ts'

/** One typed Agent call over an independent Harness Session. */
export interface AgentInvocation {
  readonly taskId: string
  readonly prompt: string
}

/** One completed Agent call with its real Harness Session evidence. */
export interface AgentRun<T> {
  readonly sessionId: string
  readonly output: T
  readonly eventTypes: readonly string[]
}

/** Runtime adapter used by the orchestrator; production uses the real Harness SDK. */
export interface AgentInvoker {
  readonly profile: AgentProfile
  /**
   * Execute one structured Agent call.
   * @param invocation - task identity and complete model prompt.
   * @param schema - output validator owned by the calling task.
   * @returns validated output and real Session identity.
   */
  run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>>
  /** Release this Agent runtime and all owned Sessions. */
  close(): Promise<void>
}

/** Structured-output failure raised at the model JSON boundary. */
export class StructuredOutputError extends Error {
  /**
   * @param message - actionable parser or schema failure.
   */
  constructor(message: string) {
    super(message)
    this.name = 'StructuredOutputError'
  }
}

/**
 * Build one prompt that pins the output schema from the validator source of truth.
 * @param role - Agent role.
 * @param instructions - role-specific behavior.
 * @param input - complete task input.
 * @param schema - expected JSON output validator.
 * @returns one deterministic system-and-user prompt body.
 */
export function buildStructuredPrompt<T>(
  role: AgentProfile['role'],
  instructions: string,
  input: unknown,
  schema: z.ZodType<T>,
): string {
  return [
    `ROLE: ${role}`,
    instructions,
    'Do not use shell or file-write tools. Read-only inspection is allowed.',
    'Return exactly one JSON value. Do not add Markdown fences, commentary, or reasoning.',
    'The JSON value must satisfy this schema:',
    JSON.stringify(z.toJSONSchema(schema), null, 2),
    'TASK INPUT:',
    JSON.stringify(input, null, 2),
  ].join('\n\n')
}

/**
 * Parse one model response as JSON and validate it.
 * @param text - final assistant text.
 * @param schema - task-owned output validator.
 * @returns typed structured output.
 */
export function parseStructuredOutput<T>(text: string, schema: z.ZodType<T>): T {
  const trimmed = text.trim()
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
    : trimmed
  let value: unknown
  try {
    value = JSON.parse(unfenced)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new StructuredOutputError(`Agent response is not valid JSON: ${detail}`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new StructuredOutputError(`Agent response violated its output schema: ${parsed.error.message}`)
  }
  return parsed.data
}
