/** Proves a correctly generated project still passes the bundle-coverage gate. */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { AgentInvocation, AgentInvoker, AgentRun } from '../src/agent-contracts.ts'
import { defaultAgentProfiles } from '../src/harness-agents.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { TeamOrchestrator } from '../src/team-orchestrator.ts'
import { verifyProject } from '../src/verification.ts'
import type { AgentProfile } from '../src/types.ts'

const PAGES = [
  { id: 'home', title: 'Home', navigationLabel: 'Home', path: 'src/pages/HomePage.tsx', route: '/' },
  { id: 'users', title: 'Users', navigationLabel: 'Users', path: 'src/pages/UsersPage.tsx', route: '/users' },
] as const

const plannerOutput = {
  projectName: 'Two Page Admin',
  pages: PAGES.map(p => ({ ...p, description: 'd' })),
  tasks: [
    { id: 'design', title: 'D', description: 'd', role: 'ui-designer', dependencies: [], requiredCapabilities: { design: 0.6 }, writeScopes: [], priority: 80 },
    { id: 'verification', title: 'V', description: 'v', role: 'tester', dependencies: ['design'], requiredCapabilities: { testing: 0.6 }, writeScopes: [], priority: 75 },
    ...PAGES.map(p => ({
      id: p.id, title: p.title, description: 'f', role: 'frontend',
      dependencies: ['design', 'verification'], requiredCapabilities: { frontend: 0.6 },
      writeScopes: ['src/pages/'], priority: 70, pageId: p.id,
    })),
    { id: 'integration', title: 'I', description: 'i', role: 'integration', dependencies: ['home', 'users', 'verification'], requiredCapabilities: { integration: 0.6 }, writeScopes: ['src/'], priority: 60 },
  ],
}

type Handler = (invocation: AgentInvocation) => unknown

class TestInvoker implements AgentInvoker {
  private serial = 0
  constructor(readonly profile: AgentProfile, private readonly handler: Handler) {}
  async run<T>(invocation: AgentInvocation, schema: z.ZodType<T>): Promise<AgentRun<T>> {
    this.serial += 1
    return {
      sessionId: `session-${this.profile.id}-${this.serial}`,
      output: schema.parse(await this.handler(invocation)),
      eventTypes: ['turn/start', 'assistant/message', 'turn/end'],
    }
  }
  async close(): Promise<void> {}
}

function outputs(profile: AgentProfile): Handler {
  switch (profile.role) {
    case 'planner': return () => plannerOutput
    case 'ui-designer':
      return () => ({
        summary: 's', designSpec: 'd',
        tokens: {
          background: '#ffffff', surface: '#ffffff', text: '#000000', muted: '#888888',
          accent: '#2563eb', border: '#dddddd', danger: '#ff0000',
          fontFamily: 'system-ui', cardRadius: 8, spacingUnit: 4,
        },
      })
    case 'tester':
      return () => ({
        summary: 's',
        pages: PAGES.map(p => ({ pageId: p.id, route: p.route, navigationLabel: p.title, requiredText: [p.title] })),
        interactions: [{ fromRoute: '/', clickText: 'Users', expectedRoute: '/users', expectedText: 'Users' }],
      })
    case 'frontend': {
      return (invocation) => {
        const page = PAGES.find(v => invocation.prompt.includes(`"id": "${v.id}"`))
        if (page === undefined) throw new Error('no page')
        return {
          pageId: page.id,
          summary: 's',
          files: [{
            path: page.path,
            content: [
              "import { Card, Typography } from 'antd'",
              'export function Page() {',
              `  return <main><Typography.Title level={2}>${page.title}</Typography.Title><Card>body</Card></main>`,
              '}',
              '',
            ].join('\n'),
          }],
        }
      }
    }
    case 'integration':
      return () => ({
        summary: 's',
        files: [{
          path: 'src/App.tsx',
          content: [
            "import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'",
            "import './design.css'",
            ...PAGES.map(p => `import { Page as ${p.title} } from './pages/${p.title}Page.tsx'`),
            'export function App() {',
            '  return <HashRouter><nav>',
            ...PAGES.map(p => `<NavLink to="${p.route}">${p.navigationLabel}</NavLink>`),
            '</nav><Routes>',
            ...PAGES.map(p => `<Route path="${p.route}" element={<${p.title} />} />`),
            '<Route path="*" element={<Navigate to="/" replace />} />',
            '</Routes></HashRouter>',
            '}',
            '',
          ].join('\n'),
        }],
      })
    case 'repair':
      return () => ({ diagnosis: 'd', summary: 's', files: [{ path: 'src/repair-marker.ts', content: 'export {}\n' }] })
  }
}

describe('bundle coverage on a correct project', () => {
  it('passes the full real verification pipeline', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-correct-'))
    const repository = new OrchestrationRepository(':memory:')
    const profiles = defaultAgentProfiles()
    const invokers = new Map<string, AgentInvoker>()
    for (const profile of profiles) invokers.set(profile.id, new TestInvoker(profile, outputs(profile)))
    const team = new TeamOrchestrator({
      repository, invokers, profiles, workspace,
      verification: { buildTimeoutMs: 600_000, browserTimeoutMs: 60_000 },
      selfLoop: { maxRepairRounds: 3, repairTimeoutMs: 600_000 },
      maxAgentRetries: 1,
    })
    try {
      const generated = await team.generate('Build a two-page admin.')
      const result = await verifyProject(workspace, generated.verificationSpec, {
        buildTimeoutMs: 600_000,
        browserTimeoutMs: 60_000,
      })
      console.log('CHECKS:', result.report.checks.map(c => `${c.name}=${c.status}`).join(' | '))
      for (const f of result.report.findings) {
        console.log(`- ${f.code} | ${f.target} | ${f.message.slice(0, 130)}`)
      }
      expect(result.status).toBe('PASS')
      expect(result.report.checks.find(c => c.name === 'bundle-coverage')?.status).toBe('PASS')
    } finally {
      await team.close()
      repository.close()
    }
  }, 900_000)
})
