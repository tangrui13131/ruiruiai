/** Tests for fault injection and golden workspace management. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureGoldenWorkspaceSnapshot,
  injectFault,
  restoreGoldenWorkspaceSnapshot,
  saveGoldenWorkspaceSnapshot,
} from '../src/fault-injection.ts'
import { writeProjectScaffold } from '../src/project-scaffold.ts'
import type { TaskSnapshot, TesterOutput } from '../src/types.ts'
import { ProjectId, TaskId } from '../src/brand.ts'

const TEST_SPEC: TesterOutput = {
  summary: 'Dashboard test spec',
  pages: [{
    pageId: 'overview',
    route: '/',
    navigationLabel: 'Overview',
    requiredText: ['Dashboard Overview'],
  }],
  interactions: [],
}

describe('fault-injection', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dsh-fault-drill-test-'))
    writeProjectScaffold(workspace)
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('saves and restores golden workspace snapshots', async () => {
    const appPath = join(workspace, 'src', 'App.tsx')
    await writeFile(appPath, 'export function App() { return <div>Original</div> }\n')
    await saveGoldenWorkspaceSnapshot(workspace)

    await writeFile(appPath, 'export function App() { return <div>Mutated</div> }\n')
    expect(await readFile(appPath, 'utf8')).toContain('Mutated')

    const restored = await restoreGoldenWorkspaceSnapshot(workspace)
    expect(restored).toBe(true)
    expect(await readFile(appPath, 'utf8')).toContain('Original')
  })

  it('injects a TypeScript contract fault into App.tsx', async () => {
    const appPath = join(workspace, 'src', 'App.tsx')
    await writeFile(appPath, 'export function App() { return <div>Original</div> }\n')
    await saveGoldenWorkspaceSnapshot(workspace)

    const result = await injectFault(workspace, 'preset:typescript-contract', TEST_SPEC)
    expect(result.mode).toBe('preset:typescript-contract')
    expect(result.targetFile).toBe('src/App.tsx')

    const content = await readFile(appPath, 'utf8')
    expect(content).toContain('// [fault-drill:typescript-contract]')
    expect(content).toContain('DrillExpectedContract')
    expect(content).toContain('CONTRACT_TYPE_MISMATCH')
  })

  it('injects a browser behavior fault by mutating declared required text', async () => {
    const appPath = join(workspace, 'src', 'App.tsx')
    await writeFile(
      appPath,
      'export function App() { return <main><h1>Dashboard Overview</h1></main> }\n',
    )
    await saveGoldenWorkspaceSnapshot(workspace)

    const result = await injectFault(workspace, 'preset:browser-behavior', TEST_SPEC)
    expect(result.mode).toBe('preset:browser-behavior')
    expect(result.targetFile).toBe('src/App.tsx')

    const content = await readFile(appPath, 'utf8')
    expect(content).not.toContain('<h1>Dashboard Overview</h1>')
    expect(content).toContain('__MUTATED_Dashboard Overview__')
  })

  it('supports manual workspace mode without touching files', async () => {
    const appPath = join(workspace, 'src', 'App.tsx')
    await writeFile(appPath, 'export function App() { return <div>Custom Manual Edit</div> }\n')

    const result = await injectFault(workspace, 'manual:workspace', TEST_SPEC)
    expect(result.mode).toBe('manual:workspace')
    expect(result.targetFile).toBeUndefined()

    const content = await readFile(appPath, 'utf8')
    expect(content).toContain('Custom Manual Edit')
  })

  it('restores golden workspace on restore:golden mode', async () => {
    const appPath = join(workspace, 'src', 'App.tsx')
    await writeFile(appPath, 'export function App() { return <div>Pristine Golden</div> }\n')
    await saveGoldenWorkspaceSnapshot(workspace)

    await writeFile(appPath, 'export function App() { return <div>Broken Edit</div> }\n')
    const result = await injectFault(workspace, 'restore:golden', TEST_SPEC)
    expect(result.mode).toBe('restore:golden')

    const content = await readFile(appPath, 'utf8')
    expect(content).toContain('Pristine Golden')
  })

  it('reconstructs golden workspace from task outputs when snapshot is missing', async () => {
    const dummyTask: TaskSnapshot = {
      id: TaskId('task-ui'),
      projectId: ProjectId('project-test'),
      title: 'UI Design',
      description: 'UI Design task',
      role: 'ui-designer',
      status: 'COMPLETED',
      revision: 1,
      retryCount: 0,
      priority: 10,
      dependencies: [],
      requiredCapabilities: {},
      writeScopes: ['src/'],
      excludedAgentIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: {
        summary: 'Design summary',
        designSpec: 'Minimalist',
        tokens: {
          background: '#ffffff',
          surface: '#f5f5f5',
          text: '#000000',
          muted: '#888888',
          accent: '#1890ff',
          border: '#e8e8e8',
          danger: '#ff4d4f',
          fontFamily: 'sans-serif',
          cardRadius: 4,
          spacingUnit: 8,
        },
      },
    }

    const ready = await ensureGoldenWorkspaceSnapshot(workspace, [dummyTask])
    expect(ready).toBe(true)
    const designCss = await readFile(join(workspace, 'src', 'design.css'), 'utf8')
    expect(designCss).toContain('--app-background: #ffffff')
  })
})
