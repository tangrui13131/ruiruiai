import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AgentInvocation, AgentInvoker, AgentRun } from '../src/agent-contracts.ts'
import type { AgentProfile } from '../src/types.ts'
import {
  createHarnessAgentTeam,
  defaultAgentProfiles,
} from '../src/harness-agents.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { TeamOrchestrator } from '../src/team-orchestrator.ts'

const hasKey = process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== ''

class TrackingInvoker implements AgentInvoker {
  constructor(
    readonly profile: AgentProfile,
    private readonly inner: AgentInvoker,
    private readonly onStart: () => void,
    private readonly onEnd: () => void,
  ) {}

  async run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    this.onStart()
    try {
      return await this.inner.run(invocation, schema)
    } finally {
      this.onEnd()
    }
  }

  async close(): Promise<void> {
    await this.inner.close()
  }
}

describe.skipIf(!hasKey)('Future Cup M2 real Agent team', () => {
  it('runs real Planner, Designer, parallel Frontend Agents, Integration, and build verification', {
    timeout: 1_200_000,
    retry: 0,
  }, async () => {
    const artifactRoot = resolve(import.meta.dirname, '../../../../.artifacts/future-cup-m2')
    mkdirSync(artifactRoot, { recursive: true })
    const runRoot = mkdtempSync(join(artifactRoot, 'run-'))
    const workspace = join(runRoot, 'workspace')
    const agentHomes = join(runRoot, 'agent-homes')
    const databasePath = join(runRoot, 'orchestration.sqlite')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(agentHomes, { recursive: true })

    const repository = new OrchestrationRepository(databasePath)
    const profiles = defaultAgentProfiles()
    const realInvokers = createHarnessAgentTeam(profiles, {
      workspace,
      homeRoot: agentHomes,
      model: 'deepseek-flash',
      requestTimeoutMs: 600_000,
    })
    let activeFrontends = 0
    let maxActiveFrontends = 0
    const invokers = new Map<string, AgentInvoker>()
    for (const profile of profiles) {
      const inner = realInvokers.get(profile.id)
      if (inner === undefined) throw new Error(`missing real invoker for ${profile.id}`)
      invokers.set(profile.id, new TrackingInvoker(
        profile,
        inner,
        () => {
          if (profile.role !== 'frontend') return
          activeFrontends += 1
          maxActiveFrontends = Math.max(maxActiveFrontends, activeFrontends)
        },
        () => {
          if (profile.role === 'frontend') activeFrontends -= 1
        },
      ))
    }

    const team = new TeamOrchestrator({
      repository,
      invokers,
      profiles,
      workspace,
      maxAgentRetries: 1,
    })
    try {
      const result = await team.run([
        'Build an admin dashboard using React, TypeScript, Vite, and Ant Design.',
        'It must include a metrics dashboard page and a user management page.',
        'Include visible navigation between both pages.',
        'Use a shared responsive visual system with no backend data.',
      ].join(' '))

      const frontendTasks = result.tasks.filter(task => task.role === 'frontend')
      const frontendExecutions = result.executions.filter(execution =>
        frontendTasks.some(task => task.id === execution.taskId),
      )
      writeFileSync(
        join(runRoot, 'run-result.json'),
        `${JSON.stringify({
          result,
          maxActiveFrontends,
          databasePath,
          workspace,
          agentHomes,
        }, null, 2)}\n`,
      )
      expect(result.verification.status).toBe('PASS')
      expect(frontendTasks).toHaveLength(2)
      expect(new Set(frontendExecutions.map(execution => execution.agentId)).size).toBe(2)
      expect(maxActiveFrontends).toBe(2)
      expect(result.executions.length).toBeGreaterThanOrEqual(5)
      expect(new Set(result.executions.map(execution => execution.sessionId)).size)
        .toBeGreaterThanOrEqual(5)
      expect(result.executions.every(execution => execution.sessionId !== undefined)).toBe(true)
      expect(result.tasks.every(task => task.status === 'COMPLETED')).toBe(true)
    } finally {
      await team.close()
      repository.close()
    }
  })
})
