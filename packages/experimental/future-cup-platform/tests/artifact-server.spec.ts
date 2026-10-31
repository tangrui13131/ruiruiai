import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OrchestrationRepository,
  ProjectId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import { registerFutureCupArtifacts } from '../src/artifact-server.ts'

const apps: FastifyInstance[] = []
const repositories: OrchestrationRepository[] = []
const roots: string[] = []

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Future Cup artifact routes', () => {
  it('serves the SPA, screenshots, delivery, and generated-project preview without leaking host paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-artifacts-'))
    roots.push(root)
    const runRoot = join(root, 'runs')
    const uiRoot = join(root, 'ui')
    const workspace = join(runRoot, 'run-1/workspace')
    const preview = join(workspace, 'dist')
    const screenshots = join(runRoot, 'run-1/screenshots')
    mkdirSync(join(uiRoot, 'assets'), { recursive: true })
    mkdirSync(preview, { recursive: true })
    mkdirSync(screenshots, { recursive: true })
    writeFileSync(join(uiRoot, 'index.html'), '<div id="app">management</div>')
    writeFileSync(join(uiRoot, 'assets/app.js'), 'globalThis.loaded = true')
    writeFileSync(join(preview, 'index.html'), '<div id="generated">preview</div>')
    const screenshot = join(screenshots, 'desktop.png')
    writeFileSync(screenshot, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const repository = new OrchestrationRepository(':memory:', {
      journalMode: 'delete',
      now: () => new Date('2026-10-31T12:00:00.000Z'),
    })
    repositories.push(repository)
    const projectId = ProjectId('project-artifacts')
    repository.createProject({
      id: projectId,
      name: 'Artifacts',
      requirement: 'Build pages',
      createdAt: '2026-10-31T12:00:00.000Z',
    }, [])
    const run = repository.createProjectRun(projectId, 'worker-a', 1n, workspace)
    repository.saveVerificationReport(projectId, 'PASS', {
      verifier: 'future-cup-m3',
      status: 'PASS',
      failureSignature: null,
      checks: [],
      findings: [],
      routes: ['/'],
      viewports: ['desktop'],
      screenshots: [screenshot],
    })
    repository.finishProjectRun(run.id, 'PASSED', preview)

    const app = Fastify({ logger: false, forceCloseConnections: true })
    apps.push(app)
    registerFutureCupArtifacts(app, {
      store: repository,
      runRoot,
      uiRoot,
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    const base = `http://127.0.0.1:${String(address.port)}`

    expect(await (await fetch(`${base}/`)).text()).toContain('management')
    expect(await (await fetch(`${base}/assets/app.js`)).text()).toContain('loaded')
    expect(await (await fetch(`${base}/preview/project-artifacts/`)).text())
      .toContain('preview')

    const screenshotResponse = await fetch(
      `${base}/api/v1/projects/project-artifacts/screenshots/desktop.png`,
    )
    expect(screenshotResponse.status).toBe(200)
    expect(screenshotResponse.headers.get('content-type')).toBe('image/png')
    await screenshotResponse.arrayBuffer()

    const delivery = await (await fetch(
      `${base}/api/v1/projects/project-artifacts/delivery`,
    )).json() as Record<string, unknown>
    expect(delivery).toMatchObject({
      projectId: 'project-artifacts',
      runId: run.id,
      status: 'PASSED',
      previewUrl: '/preview/project-artifacts/',
    })
    expect(delivery.workspacePath).not.toContain(root)
    expect(JSON.stringify(delivery)).not.toContain(workspace)
    expect(delivery.screenshots).toEqual([{
      name: 'desktop.png',
      url: '/api/v1/projects/project-artifacts/screenshots/desktop.png',
    }])

    const traversal = await fetch(
      `${base}/preview/project-artifacts/%252e%252e/%252e%252e/etc/passwd`,
    )
    expect([400, 404]).toContain(traversal.status)
    await traversal.arrayBuffer()
  })
})
