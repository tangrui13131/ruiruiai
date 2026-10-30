import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AgentInvocation, AgentInvoker, AgentRun } from '../src/agent-contracts.ts'
import {
  createHarnessAgentTeam,
  defaultAgentProfiles,
} from '../src/harness-agents.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { verificationReportDataSchema } from '../src/schemas.ts'
import { TeamOrchestrator } from '../src/team-orchestrator.ts'
import type { AgentProfile } from '../src/types.ts'
import { verifyProject } from '../src/verification.ts'

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

describe.skipIf(!hasKey)('Future Cup M3 real verification and repair loop', () => {
  it('repairs an injected failure in an independent real Harness Session and passes full reverification', {
    timeout: 2_400_000,
    retry: 0,
  }, async () => {
    const artifactRoot = resolve(import.meta.dirname, '../../../../.artifacts/future-cup-m3')
    mkdirSync(artifactRoot, { recursive: true })
    const runRoot = mkdtempSync(join(artifactRoot, 'run-'))
    const workspace = join(runRoot, 'workspace')
    const agentHomes = join(runRoot, 'agent-homes')
    const screenshotDir = join(runRoot, 'screenshots')
    const databasePath = join(runRoot, 'orchestration.sqlite')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(agentHomes, { recursive: true })
    mkdirSync(screenshotDir, { recursive: true })

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
      verification: {
        buildTimeoutMs: 600_000,
        browserTimeoutMs: 60_000,
        screenshotDir,
      },
      selfLoop: {
        maxRepairRounds: 3,
        repairTimeoutMs: 600_000,
      },
      maxAgentRetries: 1,
    })

    try {
      const generated = await team.generate([
        'Build an admin dashboard using React, TypeScript, Vite, and Ant Design.',
        'It must include a static metrics dashboard page and a static user list page.',
        'Include visible navigation between both pages as the only required interaction.',
        'Use a shared responsive visual system with no backend data, forms, modals, notifications, or message bridges.',
      ].join(' '))

      const baseline = await verifyProject(generated.workspace, generated.verificationSpec, {
        buildTimeoutMs: 600_000,
        browserTimeoutMs: 60_000,
        screenshotDir: join(runRoot, 'baseline-screenshots'),
      })
      if (baseline.status !== 'PASS') {
        throw new Error(`generated baseline did not pass before fault injection: ${JSON.stringify(baseline.report)}`)
      }
      const appPath = join(workspace, 'src/App.tsx')
      if (!existsSync(appPath)) throw new Error('generated src/App.tsx is missing before fault injection')
      appendFileSync(
        appPath,
        "\nconst injectedBuildFailure: number = 'm3 deterministic fault injection'\n",
      )

      const healed = await team.verifyAndRepair(generated)
      const finalReport = verificationReportDataSchema.parse(healed.verification.report)
      const finalExecutions = repository.listExecutions(generated.projectId)
      writeFileSync(
        join(runRoot, 'run-result.json'),
        `${JSON.stringify({
          generated,
          baseline,
          healed,
          finalExecutions,
          maxActiveFrontends,
          faultInjection: {
            path: 'src/App.tsx',
            content: "const injectedBuildFailure: number = 'm3 deterministic fault injection'",
          },
          databasePath,
          workspace,
          agentHomes,
          screenshotDir,
        }, null, 2)}\n`,
      )

      const generationSessions = generated.executions
        .map(execution => execution.sessionId)
        .filter(sessionId => sessionId !== undefined)
      const repairExecutions = finalExecutions.filter(execution => execution.agentId === 'repair')
      const browserChecks = finalReport.checks.filter(check => check.name.startsWith('browser:'))

      expect(generated.tasks).toHaveLength(5)
      expect(generated.tasks.every(task => task.status === 'COMPLETED')).toBe(true)
      expect(maxActiveFrontends).toBe(2)
      expect(generationSessions.length).toBeGreaterThanOrEqual(6)
      expect(new Set(generationSessions).size).toBe(generationSessions.length)
      expect(healed.verificationReports[0]?.status).toBe('FAIL')
      expect(healed.verification.status).toBe('PASS')
      expect(healed.workflow.status).toBe('PASSED')
      expect(healed.repairs.length).toBeGreaterThanOrEqual(1)
      expect(healed.repairs.every(repair => repair.diff.trim() !== '')).toBe(true)
      expect(healed.repairs[0]?.diff).toContain('injectedBuildFailure')
      expect(repairExecutions.length).toBeGreaterThanOrEqual(1)
      expect(repairExecutions.every(execution => execution.sessionId !== undefined)).toBe(true)
      expect(repairExecutions.every(execution =>
        execution.sessionId !== undefined && !generationSessions.includes(execution.sessionId),
      )).toBe(true)
      expect(browserChecks.filter(check => check.status === 'PASS')).toHaveLength(4)
      expect(finalReport.screenshots.length).toBe(4)
      expect(finalReport.screenshots.every(path => existsSync(path))).toBe(true)
    } finally {
      await team.close()
      repository.close()
    }
  })
})
