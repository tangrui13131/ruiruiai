import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { SessionTurnError } from '@deepseek-ai/dsh-sdk-client'
import type { AgentInvocation, AgentInvoker, AgentRun } from '../src/agent-contracts.ts'
import { selectRepairStrategy } from '../src/adaptive-repair.ts'
import { AgentId, ProjectId } from '../src/brand.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { jsonValueSchema } from '../src/schemas.ts'
import {
  activeControlTask,
  repairProfile as requireRepairProfile,
  requireStrategyDecision,
  requiredSignature,
  SelfLoopController,
  summarizeFindings,
} from '../src/self-healer.ts'
import { WorkflowControlCoordinator } from '../src/workflow-control-coordinator.ts'
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
  readonly invocations: AgentInvocation[] = []
  constructor(
    readonly profile: AgentProfile,
    private readonly contents: readonly string[],
    private readonly waitMs = 0,
  ) {}

  async run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    if (this.waitMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, this.waitMs))
    }
    this.invocations.push(invocation)
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

class FailingRepairInvoker implements AgentInvoker {
  constructor(readonly profile: AgentProfile, private readonly error: unknown) {}

  async run<T>(_invocation: AgentInvocation, _schema: z.ZodType<T>): Promise<AgentRun<T>> {
    throw this.error
  }

  async close(): Promise<void> {}
}

class RetryThenRepairInvoker extends RepairInvoker {
  attempts = 0

  override async run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    this.attempts += 1
    if (this.attempts === 1) {
      throw new SessionTurnError({ code: 'TRANSPORT', message: 'transient provider failure' })
    }
    return await super.run(invocation, schema)
  }
}

class DrainToolsRepairInvoker extends RepairInvoker {
  override async run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    const resultValue = await super.run(invocation, schema)
    Object.assign(this.profile, { toolAllowlist: [] })
    return resultValue
  }
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

function setup(
  contents: readonly string[],
  waitMs = 0,
  profile: AgentProfile = repairProfile,
  invokerOverride?: AgentInvoker,
) {
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
  const invoker: AgentInvoker = invokerOverride
    ?? (waitMs < 0
      ? new NeverRepairInvoker()
      : new RepairInvoker(profile, contents, waitMs))
  const invokers = new Map<string, AgentInvoker>([[profile.id, invoker]])
  return { workspace, repository, invokers }
}

describe('SelfLoopController', () => {
  it('rejects invalid bounds and a missing verifier', () => {
    const { workspace, repository, invokers } = setup([])
    const base = {
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
    }

    expect(() => new SelfLoopController({
      ...base,
      config: { maxRepairRounds: -1, repairTimeoutMs: 1_000 },
      verifier: async () => result('PASS'),
    })).toThrow(/maxRepairRounds/)
    expect(() => new SelfLoopController({
      ...base,
      config: { maxRepairRounds: 1, repairTimeoutMs: 0 },
      verifier: async () => result('PASS'),
    })).toThrow(/repairTimeoutMs/)
    expect(() => new SelfLoopController({
      ...base,
      config: { maxRepairRounds: 1, repairTimeoutMs: 1_000 },
    })).toThrow(/verification function/)
    expect(() => new SelfLoopController({
      ...base,
      config: { maxRepairRounds: 1, repairTimeoutMs: 1_000 },
      maxAgentRetries: -1,
      verifier: async () => result('PASS'),
    })).toThrow(/maxAgentRetries/)
    expect(() => new SelfLoopController({
      ...base,
      config: { maxRepairRounds: 1, repairTimeoutMs: 1_000 },
      verifier: async () => result('PASS'),
    })).not.toThrow()
  })

  it('completes an initial PASS without invoking repair', async () => {
    const { workspace, repository, invokers } = setup([])
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 1, repairTimeoutMs: 1_000 },
      verifier: async () => result('PASS'),
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({ status: 'PASSED', repairRound: 0 })
    expect(outcome.repairs).toEqual([])
    expect(repository.getWorkflowControlState(projectId)?.snapshot.status).toBe('PASSED')
  })

  it('escalates an initial INCOMPLETE verification', async () => {
    const { workspace, repository, invokers } = setup([])
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 2, repairTimeoutMs: 1_000 },
      verifier: async () => result('INCOMPLETE'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'VERIFIER_INCOMPLETE',
    })
    expect(outcome.repairs).toEqual([])
  })

  it('escalates before repair when automatic repair is disabled', async () => {
    const { workspace, repository, invokers } = setup([])
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 0, repairTimeoutMs: 1_000 },
      verifier: async () => result('FAIL', 'a'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'MAX_REPAIR_ROUNDS',
    })
  })

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
    const strategies = repository.listRepairStrategyDecisions(projectId)
    expect(strategies).toHaveLength(1)
    expect(strategies[0]).toMatchObject({
      repairRound: 1,
      failureSignature: signature('a'),
      strategyId: 'typescript-contract',
      repairRecordId: outcome.repairs[0]?.id,
      outcome: {
        status: 'PASS',
        nextAction: 'COMPLETE',
      },
    })
    expect(strategies[0]?.decision).toMatchObject({
      selectedStrategy: { id: 'typescript-contract' },
      reverifyScope: 'FULL_VERIFICATION',
    })
    expect((invokers.get(repairProfile.id) as RepairInvoker).invocations[0]?.prompt)
      .toContain('typescript-contract')
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

  it('escalates when reverification fails to complete after repair', async () => {
    const { workspace, repository, invokers } = setup(["export const app = 'fixed'\n"])
    let verification = 0
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => {
        verification += 1
        if (verification === 1) return result('FAIL', 'a')
        throw new Error('browser runtime disappeared')
      },
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'VERIFIER_INCOMPLETE',
      escalationMessage: 'browser runtime disappeared',
    })
    expect(outcome.repairs).toHaveLength(1)
  })

  it('preserves a non-Error verifier failure as text', async () => {
    const { workspace, repository, invokers } = setup(["export const app = 'fixed'\n"])
    let verification = 0
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => {
        verification += 1
        if (verification === 1) return result('FAIL', 'a')
        throw 'verifier unavailable'
      },
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'VERIFIER_INCOMPLETE',
      escalationMessage: 'verifier unavailable',
    })
  })

  it('records a non-completing reverification as an explicit escalation', async () => {
    const { workspace, repository, invokers } = setup(["export const app = 'fixed'\n"])
    const verifications = [result('FAIL', 'a'), result('INCOMPLETE', 'b')]
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => verifications.shift() ?? result('INCOMPLETE'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'VERIFIER_INCOMPLETE',
    })
    expect(repository.getWorkflowControlState(projectId)?.snapshot.status).toBe('ESCALATED')
  })

  it('reports incomplete verification at the repair-round ceiling', async () => {
    const { workspace, repository, invokers } = setup([
      "export const app = 'fixed-1'\n",
      "export const app = 'fixed-2'\n",
      "export const app = 'fixed-3'\n",
    ])
    const verifications = [
      result('FAIL', 'a'),
      result('FAIL', 'b'),
      result('FAIL', 'c'),
      result('INCOMPLETE', 'd'),
    ]
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => verifications.shift() ?? result('INCOMPLETE', 'z'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'VERIFIER_INCOMPLETE',
    })
    expect(repository.getWorkflowControlState(projectId)?.snapshot.status).toBe('ESCALATED')
  })

  it('treats WARNING as a failed verification and may pass after another repair', async () => {
    const { workspace, repository, invokers } = setup([
      "export const app = 'fixed-1'\n",
      "export const app = 'fixed-2'\n",
    ])
    const verifications = [
      result('FAIL', 'a'),
      result('WARNING', 'b'),
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

    expect(outcome.workflow.status).toBe('PASSED')
    expect(outcome.repairs.map(repair => repair.beforeStatus)).toEqual(['FAIL', 'WARNING'])
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

  it.each([1, 2, 4])(
    'keeps the workflow control terminal at maxRepairRounds=%i',
    async (maxRepairRounds) => {
      const contents = Array.from(
        { length: maxRepairRounds },
        (_, index) => `export const app = 'fixed-${String(index + 1)}'\n`,
      )
      const { workspace, repository, invokers } = setup(contents)
      let verificationIndex = 0
      const controller = new SelfLoopController({
        repository,
        invokers,
        profiles: [repairProfile],
        workspace,
        config: { maxRepairRounds, repairTimeoutMs: 1_000 },
        verifier: async () => {
          verificationIndex += 1
          return result('FAIL', String(verificationIndex))
        },
        now: NOW,
      })

      const outcome = await controller.run(projectId, spec)

      expect(outcome.repairs).toHaveLength(maxRepairRounds)
      expect(outcome.workflow).toMatchObject({
        status: 'ESCALATED',
        escalationReason: 'MAX_REPAIR_ROUNDS',
      })
      expect(repository.getWorkflowControlState(projectId)?.snapshot).toMatchObject({
        status: 'ESCALATED',
        escalationReason: 'MAX_REPAIR_ROUNDS',
      })
    },
  )

  it('switches strategy once, then escalates a still-repeated failure signature', async () => {
    const { workspace, repository, invokers } = setup(["export const app = 'still-broken'\n"])
    const verifications = [result('FAIL', 'a'), result('FAIL', 'a'), result('FAIL', 'a')]
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

    expect(outcome.repairs).toHaveLength(2)
    expect(outcome.workflow.status).toBe('ESCALATED')
    expect(outcome.workflow.escalationReason).toBe('REPEATED_FAILURE')
    const strategies = repository.listRepairStrategyDecisions(projectId)
    expect(strategies.map(strategy => strategy.strategyId))
      .toEqual(['typescript-contract', 'bounded-regression'])
    expect(strategies.map(strategy => strategy.outcome)).toEqual([
      expect.objectContaining({ nextAction: 'SWITCH_STRATEGY' }),
      expect.objectContaining({ nextAction: 'ESCALATE_REPEATED_FAILURE' }),
    ])
    expect(repository.getWorkflowControlState(projectId)?.snapshot).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'REPEATED_FAILURE',
    })
  })

  it('passes after switching strategy for a repeated signature', async () => {
    const { workspace, repository, invokers } = setup([
      "export const app = 'first-strategy'\n",
      "export const app = 'second-strategy'\n",
    ])
    const verifications = [result('FAIL', 'a'), result('FAIL', 'a'), result('PASS')]
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
    expect(outcome.repairs).toHaveLength(2)
    expect(repository.listRepairStrategyDecisions(projectId).map(value => value.strategyId))
      .toEqual(['typescript-contract', 'bounded-regression'])
    expect(repository.listRepairStrategyDecisions(projectId)[1]?.decision)
      .toMatchObject({
        repeatedSignature: true,
        swappedFromStrategyId: 'typescript-contract',
        nextRoundExpectation: 'SWITCHED_STRATEGY',
      })
  })

  it('escalates explicitly when no repair strategy is eligible for the available tools', async () => {
    const noToolsProfile = {
      ...repairProfile,
      id: AgentId('repair-no-tools'),
      toolAllowlist: [],
    }
    const { workspace, repository, invokers } = setup([], 0, noToolsProfile)
    const controller = new SelfLoopController({
      repository,
      invokers,
      profiles: [noToolsProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => result('FAIL', 'a'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'REPAIR_STRATEGY_UNAVAILABLE',
    })
    expect(outcome.repairs).toEqual([])
    const strategies = repository.listRepairStrategyDecisions(projectId)
    expect(strategies[0]?.strategyId).toBe('none')
    expect(strategies[0]?.outcome).toMatchObject({
      nextAction: 'NO_ELIGIBLE_STRATEGY',
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

  it.each([
    ['Error', new Error('Agent process failed')],
    ['string', 'Agent process failed'],
  ])('records a failed Repair Agent after a thrown %s', async (_label, thrown) => {
    const invoker = new FailingRepairInvoker(repairProfile, thrown)
    const { workspace, repository } = setup([], 0, repairProfile, invoker)
    const controller = new SelfLoopController({
      repository,
      invokers: new Map([[repairProfile.id, invoker]]),
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 2, repairTimeoutMs: 1_000 },
      verifier: async () => result('FAIL', 'a'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'REPAIR_FAILED',
    })
    expect(outcome.repairs[0]?.afterStatus).toBe('INCOMPLETE')
  })

  it('retries a transient Repair turn without consuming a repair round', async () => {
    const invoker = new RetryThenRepairInvoker(
      repairProfile,
      ["export const app = 'recovered'\n"],
    )
    const { workspace, repository } = setup([], 0, repairProfile, invoker)
    const verifications = [result('FAIL', 'a'), result('PASS')]
    const controller = new SelfLoopController({
      repository,
      invokers: new Map([[repairProfile.id, invoker]]),
      profiles: [repairProfile],
      workspace,
      config: { maxRepairRounds: 2, repairTimeoutMs: 1_000 },
      maxAgentRetries: 1,
      verifier: async () => verifications.shift() ?? result('PASS'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(invoker.attempts).toBe(2)
    expect(outcome.workflow).toMatchObject({ status: 'PASSED', repairRound: 1 })
    const repairExecution = repository.listExecutions(projectId)
      .find(execution => execution.taskId === 'repair-round-1')
    expect(repairExecution?.status).toBe('COMPLETED')
    expect(repository.listExecutionEvents(repairExecution!.id).map(event => event.eventType))
      .toContain('agent/retry')
  })

  it('escalates a distinct follow-up failure when its strategy becomes unavailable', async () => {
    const mutableProfile: AgentProfile = {
      ...repairProfile,
      toolAllowlist: ['fs-read'],
    }
    const invoker = new DrainToolsRepairInvoker(
      mutableProfile,
      ["export const app = 'first-fix'\n"],
    )
    const { workspace, repository } = setup([], 0, mutableProfile, invoker)
    const verifications = [result('FAIL', 'a'), result('FAIL', 'b')]
    const controller = new SelfLoopController({
      repository,
      invokers: new Map([[mutableProfile.id, invoker]]),
      profiles: [mutableProfile],
      workspace,
      config: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      verifier: async () => verifications.shift() ?? result('FAIL', 'b'),
      now: NOW,
    })

    const outcome = await controller.run(projectId, spec)

    expect(outcome.workflow).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'REPAIR_STRATEGY_UNAVAILABLE',
    })
    expect(outcome.repairs).toHaveLength(1)
  })

  it('exposes explicit defensive failures for missing control and verification evidence', async () => {
    const { repository } = setup([])
    const control = await new WorkflowControlCoordinator(repository, undefined, NOW).start(projectId)
    expect(activeControlTask(control, 'verification')).toBeDefined()
    expect(() => activeControlTask(control, 'missing')).toThrow(/no active task/)
    expect(requireRepairProfile([repairProfile])).toBe(repairProfile)
    expect(() => requireRepairProfile([])).toThrow(/not configured/)
    const decision = selectRepairStrategy({
      report: result('FAIL', 'c').report,
      repairRound: 1,
      maxRepairRounds: 3,
      availableTools: ['fs-read'],
      priorStrategies: [],
    })
    expect(requireStrategyDecision(decision)).toBe(decision)
    expect(() => requireStrategyDecision(undefined)).toThrow(/no strategy decision/)

    const withoutFindings = repository.saveVerificationReport(
      projectId,
      'FAIL',
      jsonValueSchema.parse({ ...result('FAIL', 'a').report, findings: [] }),
      undefined,
      signature('a'),
    )
    expect(summarizeFindings(withoutFindings)).toBe('Verification FAIL')

    const unsigned = repository.saveVerificationReport(
      projectId,
      'FAIL',
      jsonValueSchema.parse(result('FAIL', 'b').report),
    )
    expect(() => requiredSignature(unsigned)).toThrow(/did not retain a failure signature/)
  })
})
