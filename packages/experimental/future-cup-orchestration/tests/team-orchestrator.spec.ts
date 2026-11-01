import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AgentInvocation, AgentInvoker, AgentRun } from '../src/agent-contracts.ts'
import { ProjectId } from '../src/brand.ts'
import type { AgentProfile, VerificationResult } from '../src/types.ts'
import { defaultAgentProfiles } from '../src/harness-agents.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { TeamOrchestrator } from '../src/team-orchestrator.ts'

const NOW = () => new Date('2026-10-30T12:00:00.000Z')

const plannerOutput = {
  projectName: 'M2 Admin',
  pages: [
    {
      id: 'dashboard',
      title: 'Dashboard',
      description: 'Metrics',
      path: 'src/pages/DashboardPage.tsx',
      route: '/',
      navigationLabel: 'Dashboard',
    },
    {
      id: 'users',
      title: 'Users',
      description: 'Users',
      path: 'src/pages/UsersPage.tsx',
      route: '/users',
      navigationLabel: 'Users',
    },
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
      id: 'verification',
      title: 'Verification',
      description: 'Create browser assertions',
      role: 'tester',
      dependencies: ['design'],
      requiredCapabilities: { testing: 0.6 },
      writeScopes: [],
      priority: 75,
    },
    {
      id: 'dashboard',
      title: 'Dashboard page',
      description: 'Create dashboard page',
      role: 'frontend',
      dependencies: ['design', 'verification'],
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
      dependencies: ['design', 'verification'],
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
      dependencies: ['dashboard', 'users', 'verification'],
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
    case 'tester':
      return () => ({
        summary: 'Browser assertions ready',
        pages: [
          { pageId: 'dashboard', route: '/', navigationLabel: 'Dashboard', requiredText: ['dashboard'] },
          { pageId: 'users', route: '/users', navigationLabel: 'Users', requiredText: ['users'] },
        ],
        interactions: [
          { fromRoute: '/', clickText: 'Users', expectedRoute: '/users', expectedText: 'users' },
        ],
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
            '  return <HashRouter><nav><a href="#/">Dashboard</a><a href="#/users">Users</a></nav><Routes><Route path="/" element={<DashboardPage />} /><Route path="/users" element={<UsersPage />} /></Routes></HashRouter>',
            '}',
          ].join('\n'),
        }],
      })
    case 'repair':
      return () => ({
        diagnosis: 'No repair is needed for this deterministic pass case.',
        summary: 'No changes.',
        files: [{ path: 'src/repair-marker.ts', content: 'export {}\n' }],
      })
  }
}

function passingVerification(): VerificationResult {
  return {
    status: 'PASS',
    report: {
      verifier: 'future-cup-m3',
      status: 'PASS',
      failureSignature: null,
      checks: [{ name: 'test', status: 'PASS', summary: 'Passed.' }],
      findings: [],
      routes: ['/', '/users'],
      viewports: ['desktop', 'mobile'],
      screenshots: [],
    },
  }
}

describe('TeamOrchestrator', () => {
  it('runs two frontend Agents concurrently and persists six independent Sessions', async () => {
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
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      projectVerifier: async () => passingVerification(),
    })
    const registeredProject = {
      id: ProjectId('project-registered-team'),
      name: 'Registered admin',
      requirement: 'Build an admin dashboard with users',
      createdAt: NOW().toISOString(),
    }
    repository.createProject(registeredProject, [])
    try {
      const result = await team.run(registeredProject.requirement, registeredProject)
      expect(maxActiveFrontends).toBe(2)
      expect(result.projectId).toBe(registeredProject.id)
      expect(result.executions).toHaveLength(6)
      expect(new Set(result.executions.map(execution => execution.sessionId)).size).toBe(6)
      expect(result.tasks.every(task => task.status === 'COMPLETED')).toBe(true)
      expect(result.decisions).toHaveLength(5)
      expect(readFileSync(join(workspace, 'src/App.tsx'), 'utf8')).toContain('HashRouter')
      const eventTypes = repository.listProductEvents(result.projectId, 0, 200)
        .map(event => event.type)
      expect(eventTypes).toEqual(expect.arrayContaining([
        'task.created',
        'task.ready',
        'task.dispatched',
        'agent.started',
        'task.completed',
        'agent.completed',
        'verification.passed',
      ]))
      expect(repository.listProjectMemoryEntries(result.projectId).map(entry => entry.key))
        .toEqual(expect.arrayContaining([
          'design-system',
          'verification-spec',
          'page-dashboard',
          'page-users',
          'integrated-application',
        ]))
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
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      projectVerifier: async () => passingVerification(),
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

  it('rejects a frontend page that imports a shared module outside its returned files', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-unreturned-import-'))
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    const profiles = defaultAgentProfiles()
    const invokers = new Map<string, AgentInvoker>()
    for (const profile of profiles) {
      const base = outputs(profile)
      invokers.set(profile.id, new TestInvoker(profile, async (invocation) => {
        const output = await base(invocation)
        if (
          profile.role === 'frontend'
          && invocation.prompt.includes('"id": "dashboard"')
          && typeof output === 'object'
          && output !== null
          && 'files' in output
        ) {
          return {
            pageId: 'dashboard',
            summary: 'Invalid shared import',
            files: [{
              path: 'src/pages/DashboardPage.tsx',
              content: "import { appMessage } from '../messageBridge'\nexport function Page() { return <main>dashboard</main> }\n",
            }],
          }
        }
        return output
      }))
    }

    const team = new TeamOrchestrator({
      repository,
      invokers,
      profiles,
      workspace,
      verification: { buildTimeoutMs: 1_000, browserTimeoutMs: 1_000 },
      selfLoop: { maxRepairRounds: 3, repairTimeoutMs: 1_000 },
      projectVerifier: async () => passingVerification(),
    })
    try {
      await expect(team.generate('Build an admin dashboard with users'))
        .rejects.toThrow(/imports unreturned local module/)
    } finally {
      await team.close()
      repository.close()
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
