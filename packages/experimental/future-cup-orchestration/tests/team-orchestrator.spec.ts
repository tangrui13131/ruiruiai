import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AgentInvocation, AgentInvoker, AgentRun } from '../src/agent-contracts.ts'
import type { AgentProfile } from '../src/types.ts'
import { defaultAgentProfiles } from '../src/harness-agents.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { TeamOrchestrator } from '../src/team-orchestrator.ts'

const NOW = () => new Date('2026-10-30T12:00:00.000Z')

const plannerOutput = {
  projectName: 'M2 Admin',
  pages: [
    { id: 'dashboard', title: 'Dashboard', description: 'Metrics', path: 'src/pages/DashboardPage.tsx' },
    { id: 'users', title: 'Users', description: 'Users', path: 'src/pages/UsersPage.tsx' },
  ],
  tasks: [
    {
      id: 'design',
      title: 'Design',
      description: 'Create visual system',
      role: 'ui-designer',
      dependencies: [],
      requiredCapabilities: { design: 0.6 },
      writeScopes: [],
      priority: 80,
    },
    {
      id: 'dashboard',
      title: 'Dashboard page',
      description: 'Create dashboard page',
      role: 'frontend',
      dependencies: ['design'],
      requiredCapabilities: { frontend: 0.6 },
      writeScopes: ['src/pages/'],
      priority: 70,
      pageId: 'dashboard',
    },
    {
      id: 'users',
      title: 'Users page',
      description: 'Create users page',
      role: 'frontend',
      dependencies: ['design'],
      requiredCapabilities: { frontend: 0.6 },
      writeScopes: ['src/pages/'],
      priority: 70,
      pageId: 'users',
    },
    {
      id: 'integration',
      title: 'Integrate',
      description: 'Build routes',
      role: 'integration',
      dependencies: ['dashboard', 'users'],
      requiredCapabilities: { integration: 0.6 },
      writeScopes: ['src/'],
      priority: 60,
    },
  ],
}

type Handler = (invocation: AgentInvocation) => unknown

class TestInvoker implements AgentInvoker {
  private sessionSerial = 0
  constructor(readonly profile: AgentProfile, private readonly handler: Handler) {}

  async run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    this.sessionSerial += 1
    return {
      sessionId: `session-${this.profile.id}-${this.sessionSerial}`,
      output: schema.parse(await this.handler(invocation)),
      eventTypes: ['turn/start', 'assistant/message', 'turn/end'],
    }
  }

  async close(): Promise<void> {}
}

function outputs(profile: AgentProfile): Handler {
  switch (profile.role) {
    case 'planner':
      return () => plannerOutput
    case 'ui-designer':
      return () => ({
        summary: 'Design ready',
        designSpec: 'Use a restrained admin dashboard style.',
        tokens: {
          background: '#f5f7f6',
          surface: '#ffffff',
          text: '#17231c',
          muted: '#667085',
          accent: '#2563eb',
          border: '#d7dee8',
          danger: '#c9362b',
          fontFamily: 'system-ui, sans-serif',
          cardRadius: 12,
          spacingUnit: 4,
        },
      })
    case 'frontend':
      return (invocation) => {
        const pageId = invocation.prompt.includes('"id": "dashboard"') ? 'dashboard' : 'users'
        return {
          pageId,
          summary: `${pageId} ready`,
          files: [{
            path: pageId === 'dashboard' ? 'src/pages/DashboardPage.tsx' : 'src/pages/UsersPage.tsx',
            content: `export function Page() { return <main>${pageId}</main> }`,
          }],
        }
      }
    case 'integration':
      return () => ({
        summary: 'Integrated',
        files: [{
          path: 'src/App.tsx',
          content: [
            "import { HashRouter, Route, Routes } from 'react-router-dom'",
            "import './design.css'",
            "import { Page as DashboardPage } from './pages/DashboardPage.tsx'",
            "import { Page as UsersPage } from './pages/UsersPage.tsx'",
            'export function App() {',
            '  return <HashRouter><Routes><Route path="/" element={<DashboardPage />} /><Route path="/users" element={<UsersPage />} /></Routes></HashRouter>',
            '}',
          ].join('\n'),
        }],
      })
  }
}

describe('TeamOrchestrator', () => {
  it('runs two frontend Agents concurrently and persists five independent Sessions', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-team-'))
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    const profiles = defaultAgentProfiles()
    let activeFrontends = 0
    let maxActiveFrontends = 0
    let releaseFrontends!: () => void
    const bothStarted = new Promise<void>((resolve) => { releaseFrontends = resolve })

    const invokers = new Map<string, AgentInvoker>()
    for (const profile of profiles) {
      const base = outputs(profile)
      const handler: Handler = async (invocation) => {
        if (profile.role === 'frontend') {
          activeFrontends += 1
          maxActiveFrontends = Math.max(maxActiveFrontends, activeFrontends)
          if (activeFrontends === 2) releaseFrontends()
          await bothStarted
          activeFrontends -= 1
        }
        return await base(invocation)
      }
      invokers.set(profile.id, new TestInvoker(profile, handler))
    }

    const team = new TeamOrchestrator({
      repository,
      invokers,
      profiles,
      workspace,
      verifier: async () => ({ status: 'PASS', report: { passed: true } }),
    })
    try {
      const result = await team.run('Build an admin dashboard with users')
      expect(maxActiveFrontends).toBe(2)
      expect(result.executions).toHaveLength(5)
      expect(new Set(result.executions.map(execution => execution.sessionId)).size).toBe(5)
      expect(result.tasks.every(task => task.status === 'COMPLETED')).toBe(true)
      expect(result.decisions).toHaveLength(4)
      expect(readFileSync(join(workspace, 'src/App.tsx'), 'utf8')).toContain('HashRouter')
    } finally {
      await team.close()
      repository.close()
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('reassigns a failed frontend task to the other Frontend Agent', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-retry-'))
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    const profiles = defaultAgentProfiles()
    let failedOnce = false
    const invokers = new Map<string, AgentInvoker>()
    for (const profile of profiles) {
      const base = outputs(profile)
      invokers.set(profile.id, new TestInvoker(profile, async (invocation) => {
        if (profile.id === 'frontend-a' && invocation.prompt.includes('"id": "dashboard"') && !failedOnce) {
          failedOnce = true
          throw new Error('synthetic frontend failure for deterministic reassignment')
        }
        return await base(invocation)
      }))
    }

    const team = new TeamOrchestrator({
      repository,
      invokers,
      profiles,
      workspace,
      verifier: async () => ({ status: 'PASS', report: { passed: true } }),
    })
    try {
      const result = await team.run('Build an admin dashboard with users')
      const dashboardExecutions = result.executions.filter(execution => execution.taskId === 'dashboard')
      expect(dashboardExecutions.map(execution => execution.agentId)).toEqual([
        'frontend-a',
        'frontend-b',
      ])
      expect(result.decisions.some(decision =>
        decision.taskId === 'dashboard' && decision.reassignReason !== undefined,
      )).toBe(true)
    } finally {
      await team.close()
      repository.close()
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
