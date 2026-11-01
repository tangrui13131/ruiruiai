import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AgentInvocation, AgentInvoker, AgentRun } from '../src/agent-contracts.ts'
import { AgentId, ProjectId } from '../src/brand.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { SelfLoopController } from '../src/self-healer.ts'
import type {
  AgentProfile,
  TesterOutput,
  VerificationResult,
  VerificationStatus,
} from '../src/types.ts'

const roots: string[] = []
const repositories: OrchestrationRepository[] = []
const projectId = ProjectId('project-self-loop')
const NOW = () => new Date('2026-10-31T01:00:00.000Z')

const spec: TesterOutput = {
  summary: 'Routes',
  pages: [
    { pageId: 'dashboard', route: '/', navigationLabel: 'Dashboard', requiredText: ['Dashboard'] },
    { pageId: 'users', route: '/users', navigationLabel: 'Users', requiredText: ['Users'] },
  ],
  interactions: [
    { fromRoute: '/', clickText: 'Users', expectedRoute: '/users', expectedText: 'Users' },
  ],
}

const repairProfile: AgentProfile = {
  id: AgentId('repair'),
  name: 'Repair Agent',
  role: 'repair',
  capabilities: { repair: 1 },
  maxConcurrency: 1,
  currentLoad: 0,
  historicalSuccessRate: 0.75,
  available: true,
}

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

class RepairInvoker implements AgentInvoker {
  private serial = 0
  constructor(
    readonly profile: AgentProfile,
    private readonly contents: readonly string[],
    private readonly waitMs = 0,
  ) {}

  async run<T>(_invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    if (this.waitMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, this.waitMs))
    }
    const content = this.contents[Math.min(this.serial, this.contents.length - 1)] ?? 'export {}\n'
    this.serial += 1
    return {
      sessionId: `session-repair-${this.serial}`,
      output: schema.parse({
        diagnosis: 'The injected TypeScript value has the wrong type.',
        summary: `Repair attempt ${this.serial}`,
        files: [{ path: 'src/App.tsx', content }],
      }),
      eventTypes: ['turn/start', 'assistant/message', 'turn/end'],
    }
  }

  async close(): Promise<void> {}
}

class NeverRepairInvoker implements AgentInvoker {
  readonly profile = repairProfile

  async run<T>(_invocation: AgentInvocation, _schema: z.ZodType<T>): Promise<AgentRun<T>> {
    return await new Promise<AgentRun<T>>(() => {})
  }

  async close(): Promise<void> {}
}

function signature(value: string): string {
  return value.repeat(64)
}

function result(status: VerificationStatus, value = 'a'): VerificationResult {
  const findings = status === 'PASS'
    ? []
    : [{
      category: 'typescript' as const,
      code: `TS_${value.toUpperCase()}`,
      severity: 'error' as const,
      message: `Failure ${value}`,
      target: 'src/App.tsx',
    }]
  return {
    status,
    report: {
      verifier: 'future-cup-m3',
      status,
      failureSignature: status === 'PASS' ? null : signature(value),
      checks: [{
        name: 'typescript',
        status: status === 'PASS' ? 'PASS' : 'FAIL',
        summary: status === 'PASS' ? 'Passed.' : `Failed ${value}.`,
      }],
      findings,
      routes: ['/', '/users'],
      viewports: ['desktop', 'mobile'],
      screenshots: [],
    },
  }
}

function setup(contents: readonly string[], waitMs = 0) {
  const workspace = mkdtempSync(join(tmpdir(), 'future-cup-self-loop-'))
  roots.push(workspace)
  mkdirSync(join(workspace, 'src'))
  writeFileSync(join(workspace, 'src/App.tsx'), "export const app = 'original'\n")
  let serial = 0
  const repository = new OrchestrationRepository(':memory:', {
    now: NOW,
    createId: () => String(++serial),
    journalMode: 'delete',
  })
  repositories.push(repository)
  repository.createProject({
    id: projectId,
    name: 'Self-loop fixture',
    requirement: 'Inject and repair a real failure.',
    createdAt: NOW().toISOString(),
  }, [])
  const invoker: AgentInvoker = waitMs < 0
    ? new NeverRepairInvoker()
    : new RepairInvoker(repairProfile, contents, waitMs)
  const invokers = new Map<string, AgentInvoker>([[repairProfile.id, invoker]])
  return { workspace, repository, invokers }
}

describe('SelfLoopController', () => {
  it('persists one repair, its code diff, and a PASS workflow', async () => {
    const { workspace, repository, invokers } = setup(["export const app = 'fixed-1'\n"])
    const verifications = [result('FAIL', 'a'), result('PASS')]
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => verifications.shift() ?? result('PASS'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow.status).toBe('PASSED')
    expect(outcome.verification.status).toBe('PASS')
    expect(outcome.repairs).toHaveLength(1)
    expect(outcome.repairs[0]?.diff).toContain("+export const app = 'fixed-1'")
    expect(outcome.repairs[0]?.beforeStatus).toBe('FAIL')
    expect(outcome.repairs[0]?.afterStatus).toBe('PASS')
    expect(repository.listExecutions(projectId)[0]?.sessionId).toBe('session-repair-1')
    expect(repository.getWorkflowControlState(projectId)?.snapshot.status).toBe('PASSED')
    expect(repository.listWorkflowControlEvents(projectId).map(event => event.entry.type))
      .toContain('subworkflow/entered')
  })

  it('reverifies after every attempt and succeeds on the second round', async () => {
    const { workspace, repository, invokers } = setup([
      "export const app = 'fixed-1'\n",
      "export const app = 'fixed-2'\n",
    ])
    const verifications = [
      result('FAIL', 'a'),
      result('FAIL', 'b'),
      result('PASS'),
    ]
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => verifications.shift() ?? result('PASS'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.verificationReports).toHaveLength(3)
    expect(outcome.repairs).toHaveLength(2)
    expect(outcome.repairs[1]?.repairRound).toBe(2)
    expect(outcome.workflow.status).toBe('PASSED')
  })

  it('stops after three rounds and publishes MAX_REPAIR_ROUNDS', async () => {
    const { workspace, repository, invokers } = setup([
      "export const app = 'fixed-1'\n",
      "export const app = 'fixed-2'\n",
      "export const app = 'fixed-3'\n",
    ])
    const verifications = [
      result('FAIL', 'a'),
      result('FAIL', 'b'),
      result('FAIL', 'c'),
      result('FAIL', 'd'),
    ]
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => verifications.shift() ?? result('FAIL', 'z'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.verificationReports).toHaveLength(4)
    expect(outcome.repairs).toHaveLength(3)
    expect(outcome.workflow.status).toBe('ESCALATED')
    expect(outcome.workflow.escalationReason).toBe('MAX_REPAIR_ROUNDS')
  })

  it('breaks immediately when the equivalent failure signature repeats', async () => {
    const { workspace, repository, invokers } = setup(["export const app = 'still-broken'\n"])
    const verifications = [result('FAIL', 'a'), result('FAIL', 'a')]
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => verifications.shift() ?? result('FAIL', 'a'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.repairs).toHaveLength(1)
    expect(outcome.workflow.status).toBe('ESCALATED')
    expect(outcome.workflow.escalationReason).toBe('REPEATED_FAILURE')
    expect(repository.getWorkflowControlState(projectId)?.snapshot).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'REPEATED_FAILURE',
    })
  })

  it('persists a timed-out repair and an explicit escalation', async () => {
    const { workspace, repository, invokers } = setup([], -1)
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 5 },
      verifier: async () => result('FAIL', 'a'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow.status).toBe('ESCALATED')
    expect(outcome.workflow.escalationReason).toBe('REPAIR_TIMEOUT')
    expect(outcome.repairs).toHaveLength(1)
    expect(outcome.repairs[0]?.afterStatus).toBe('INCOMPLETE')
  })
})
