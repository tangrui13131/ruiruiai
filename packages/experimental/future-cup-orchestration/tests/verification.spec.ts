import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrowserVerification } from '../src/browser-verifier.ts'
import type {
  VerificationCommandResult,
  VerificationCommandRunner,
} from '../src/build-verifier.ts'
import { verifyProjectBuild } from '../src/build-verifier.ts'
import { createFailureSignature } from '../src/failure-signature.ts'
import { writeProjectScaffold } from '../src/project-scaffold.ts'
import type { TesterOutput, VerificationFinding } from '../src/types.ts'
import { verifyProject } from '../src/verification.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const spec: TesterOutput = {
  summary: 'Admin routes',
  pages: [
    { pageId: 'dashboard', route: '/', navigationLabel: 'Dashboard', requiredText: ['Metric'] },
    { pageId: 'users', route: '/users', navigationLabel: 'Users', requiredText: ['User'] },
  ],
  interactions: [
    { fromRoute: '/', clickText: 'Users', expectedRoute: '/users', expectedText: 'User' },
  ],
}

class QueueRunner implements VerificationCommandRunner {
  readonly calls: string[] = []
  constructor(private readonly results: VerificationCommandResult[]) {}

  async run(command: string, args: readonly string[]): Promise<VerificationCommandResult> {
    this.calls.push([command, ...args].join(' '))
    const result = this.results.shift()
    if (result === undefined) throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    return result
  }
}

function result(command: string, exitCode = 0, stderr = ''): VerificationCommandResult {
  return { command, exitCode, stdout: '', stderr }
}

function finding(message: string, target = 'src/pages/UsersPage.tsx'): VerificationFinding {
  return {
    category: 'typescript',
    code: 'TS2322',
    severity: 'error',
    message,
    target,
  }
}

function browserPass(): BrowserVerification {
  return {
    status: 'PASS',
    checks: [{ name: 'browser', status: 'PASS', summary: 'Browser passed.' }],
    findings: [],
    routes: ['/', '/users'],
    viewports: ['desktop', 'mobile'],
    screenshots: ['desktop-dashboard.png'],
  }
}

function writeHashRouter(workspace: string): void {
  writeFileSync(
    join(workspace, 'src/App.tsx'),
    "import { HashRouter } from 'react-router-dom'\nexport function App() { return <HashRouter /> }\n",
  )
}

describe('failure signatures', () => {
  it('normalizes order, absolute paths, and source locations', () => {
    const root = 'C:\\work\\generated-app'
    const first = createFailureSignature([
      finding('Type mismatch at C:\\work\\generated-app\\src\\App.tsx:4:2'),
      finding('Unused value', 'src/App.tsx'),
    ], root)
    const second = createFailureSignature([
      finding('Unused value', 'src/App.tsx'),
      finding('Type mismatch at C:\\work\\generated-app\\src\\App.tsx:8:9'),
    ], root)
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('distinguishes different targets and returns null without findings', () => {
    expect(createFailureSignature([])).toBeNull()
    expect(createFailureSignature([finding('Type mismatch')]))
      .not.toBe(createFailureSignature([finding('Type mismatch', 'src/App.tsx')]))
  })
})

describe('build verification', () => {
  it('reports TypeScript diagnostics from a real command-runner boundary', async () => {
    const runner = new QueueRunner([
      result('npm install'),
      result('npm run build:types', 2, 'src/pages/UsersPage.tsx(4,1): error TS2322: Type string is not assignable to number'),
      result('npm run build:bundle'),
    ])
    const verification = await verifyProjectBuild('C:\\generated', {
      timeoutMs: 1_000,
      runner,
    })
    expect(verification.status).toBe('FAIL')
    expect(verification.findings).toContainEqual(expect.objectContaining({
      code: 'TS2322',
      target: 'src/pages/UsersPage.tsx',
    }))
    expect(runner.calls).toHaveLength(3)
  })

  it('stops after dependency installation failure', async () => {
    const runner = new QueueRunner([
      result('npm install', 1, 'registry unavailable'),
    ])
    const verification = await verifyProjectBuild('C:\\generated', {
      timeoutMs: 1_000,
      runner,
    })
    expect(verification.status).toBe('FAIL')
    expect(verification.findings[0]?.code).toBe('DEPENDENCY_INSTALL_FAILED')
    expect(runner.calls).toEqual(['npm install --no-audit --no-fund'])
  })
})

describe('aggregate verification', () => {
  it('marks a structurally invalid project FAIL and skips browser execution', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-structure-'))
    roots.push(workspace)
    writeFileSync(join(workspace, 'package.json'), '{broken')
    let browserCalled = false
    const verification = await verifyProject(workspace, spec, {
      buildTimeoutMs: 1_000,
      browserTimeoutMs: 1_000,
    }, {
      browserVerifier: async () => {
        browserCalled = true
        return browserPass()
      },
    })
    expect(verification.status).toBe('FAIL')
    expect(verification.report.findings.some(value => value.code === 'PACKAGE_JSON_INVALID')).toBe(true)
    expect(verification.report.checks).toContainEqual(expect.objectContaining({
      name: 'browser',
      status: 'SKIPPED',
    }))
    expect(browserCalled).toBe(false)
  })

  it('combines successful build and browser evidence into PASS', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-pass-'))
    roots.push(workspace)
    writeProjectScaffold(workspace)
    writeHashRouter(workspace)
    const runner = new QueueRunner([
      result('npm install'),
      result('npm run build:types'),
      result('npm run build:bundle'),
    ])
    const verification = await verifyProject(workspace, spec, {
      buildTimeoutMs: 1_000,
      browserTimeoutMs: 1_000,
    }, {
      commandRunner: runner,
      browserVerifier: async () => browserPass(),
    })
    expect(verification.status).toBe('PASS')
    expect(verification.report.failureSignature).toBeNull()
    expect(verification.report.screenshots).toEqual(['desktop-dashboard.png'])
  })

  it('preserves INCOMPLETE when the browser environment cannot run', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-incomplete-'))
    roots.push(workspace)
    writeProjectScaffold(workspace)
    writeHashRouter(workspace)
    const runner = new QueueRunner([
      result('npm install'),
      result('npm run build:types'),
      result('npm run build:bundle'),
    ])
    const verification = await verifyProject(workspace, spec, {
      buildTimeoutMs: 1_000,
      browserTimeoutMs: 1_000,
    }, {
      commandRunner: runner,
      browserVerifier: async () => ({
        status: 'INCOMPLETE',
        checks: [{ name: 'browser-launch', status: 'SKIPPED', summary: 'Unavailable.' }],
        findings: [{
          category: 'browser',
          code: 'BROWSER_UNAVAILABLE',
          severity: 'error',
          message: 'Chromium is unavailable.',
        }],
        routes: ['/', '/users'],
        viewports: ['desktop', 'mobile'],
        screenshots: [],
      }),
    })
    expect(verification.status).toBe('INCOMPLETE')
  })

  it('preserves WARNING when deterministic checks pass with a non-blocking finding', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-warning-'))
    roots.push(workspace)
    writeProjectScaffold(workspace)
    writeHashRouter(workspace)
    const runner = new QueueRunner([
      result('npm install'),
      result('npm run build:types'),
      result('npm run build:bundle'),
    ])
    const verification = await verifyProject(workspace, spec, {
      buildTimeoutMs: 1_000,
      browserTimeoutMs: 1_000,
    }, {
      commandRunner: runner,
      browserVerifier: async () => ({
        ...browserPass(),
        checks: [{ name: 'browser', status: 'WARNING', summary: 'A non-blocking warning remains.' }],
        findings: [{
          category: 'browser',
          code: 'NON_BLOCKING_BROWSER_WARNING',
          severity: 'warning',
          message: 'Non-blocking warning.',
        }],
      }),
    })
    expect(verification.status).toBe('WARNING')
    expect(verification.report.failureSignature).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects BrowserRouter before build because the preview contract is hash routing', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'future-cup-router-'))
    roots.push(workspace)
    writeProjectScaffold(workspace)
    writeFileSync(
      join(workspace, 'src/main.tsx'),
      "import { BrowserRouter } from 'react-router-dom'\nexport const router = BrowserRouter\n",
    )
    const verification = await verifyProject(workspace, spec, {
      buildTimeoutMs: 1_000,
      browserTimeoutMs: 1_000,
    })
    expect(verification.status).toBe('FAIL')
    expect(verification.report.findings).toContainEqual(expect.objectContaining({
      code: 'ROUTER_CONTRACT_VIOLATION',
    }))
  })
})
