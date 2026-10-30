/** Independent static, build, and Playwright verification pipeline. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { verifyBrowser } from './browser-verifier.ts'
import type { BrowserVerification } from './browser-verifier.ts'
import { verifyProjectBuild } from './build-verifier.ts'
import type { VerificationCommandRunner } from './build-verifier.ts'
import { createFailureSignature } from './failure-signature.ts'
import type {
  TesterOutput,
  VerificationCheck,
  VerificationFinding,
  VerificationResult,
  VerificationStatus,
} from './types.ts'

const packageJsonSchema = z.looseObject({
  scripts: z.record(z.string(), z.string()),
})

/** Explicit verification limits and artifact destination. */
export interface VerificationConfig {
  readonly buildTimeoutMs: number
  readonly browserTimeoutMs: number
  readonly screenshotDir?: string | undefined
}

/** Deterministic seams used by focused unit tests. */
export interface VerificationDependencies {
  readonly commandRunner?: VerificationCommandRunner
  readonly browserVerifier?: (
    workspace: string,
    spec: TesterOutput,
    options: { timeoutMs: number; screenshotDir?: string },
  ) => Promise<BrowserVerification>
}

/**
 * Run structure, build, and browser checks with independent evidence.
 * @param workspace - generated project root.
 * @param spec - Tester-owned browser assertions.
 * @param config - explicit limits and screenshot destination.
 * @param dependencies - optional deterministic seams for focused tests.
 * @returns one aggregate report with a stable repeated-failure signature.
 */
export async function verifyProject(
  workspace: string,
  spec: TesterOutput,
  config: VerificationConfig,
  dependencies: VerificationDependencies = {},
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = []
  const findings: VerificationFinding[] = []
  const screenshots: string[] = []
  let incomplete = false

  const structureFindings = await verifyProjectStructure(workspace)
  checks.push({
    name: 'project-structure',
    status: structureFindings.length === 0 ? 'PASS' : 'FAIL',
    summary: structureFindings.length === 0
      ? 'Required React/Vite structure is present.'
      : 'Required React/Vite structure is incomplete.',
  })
  findings.push(...structureFindings)

  if (structureFindings.length > 0) {
    checks.push({ name: 'browser', status: 'SKIPPED', summary: 'Browser checks require a complete project.' })
    return finalize(workspace, spec, checks, findings, screenshots, incomplete)
  }

  const build = await verifyProjectBuild(workspace, {
    timeoutMs: config.buildTimeoutMs,
    ...dependencies.commandRunner === undefined ? {} : { runner: dependencies.commandRunner },
  })
  checks.push(...build.checks)
  findings.push(...build.findings)
  if (build.status !== 'PASS') {
    checks.push({ name: 'browser', status: 'SKIPPED', summary: 'Browser checks require a passing build.' })
    return finalize(workspace, spec, checks, findings, screenshots, incomplete)
  }

  try {
    const browserVerifier = dependencies.browserVerifier ?? verifyBrowser
    const browser = await browserVerifier(workspace, spec, {
      timeoutMs: config.browserTimeoutMs,
      ...config.screenshotDir === undefined ? {} : { screenshotDir: config.screenshotDir },
    })
    checks.push(...browser.checks)
    findings.push(...browser.findings)
    screenshots.push(...browser.screenshots)
    if (browser.status === 'INCOMPLETE') {
      incomplete = true
      checks.push({
        name: 'browser-environment',
        status: 'SKIPPED',
        summary: 'Browser verification could not complete in this environment.',
      })
    }
  } catch (error: unknown) {
    incomplete = true
    checks.push({ name: 'browser', status: 'SKIPPED', summary: 'Browser verifier failed to complete.' })
    findings.push({
      category: 'browser',
      code: 'BROWSER_VERIFIER_INCOMPLETE',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return finalize(workspace, spec, checks, findings, screenshots, incomplete)
}

/** Validate the generated project files that every later stage depends on. */
async function verifyProjectStructure(workspace: string): Promise<VerificationFinding[]> {
  const requiredFiles = [
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'src/main.tsx',
    'src/App.tsx',
  ]
  const findings: VerificationFinding[] = []
  const fileContents = new Map<string, string>()
  for (const file of requiredFiles) {
    const content = await readFile(join(workspace, file), 'utf8').catch(() => undefined)
    if (content === undefined) {
      findings.push({
        category: 'structure',
        code: 'REQUIRED_FILE_MISSING',
        severity: 'error',
        message: `Required generated project file "${file}" is missing.`,
        target: file,
      })
    } else {
      fileContents.set(file, content)
    }
  }

  const packageJsonText = await readFile(join(workspace, 'package.json'), 'utf8').catch(() => undefined)
  if (packageJsonText !== undefined) {
    const parsedJson = tryParseJson(packageJsonText)
    const parsed = parsedJson === undefined
      ? undefined
      : packageJsonSchema.safeParse(parsedJson)
    if (parsed === undefined || !parsed.success) {
      findings.push({
        category: 'structure',
        code: 'PACKAGE_JSON_INVALID',
        severity: 'error',
        message: parsed === undefined ? 'package.json is not valid JSON.' : parsed.error.message,
        target: 'package.json',
      })
    } else {
      for (const script of ['build:types', 'build:bundle']) {
        if (parsed.data.scripts[script] === undefined) {
          findings.push({
            category: 'structure',
            code: 'BUILD_SCRIPT_MISSING',
            severity: 'error',
            message: `package.json must declare the "${script}" script.`,
            target: 'package.json',
          })
        }
      }
    }
  }

  const indexHtml = await readFile(join(workspace, 'index.html'), 'utf8').catch(() => undefined)
  if (indexHtml !== undefined && !/<link\b[^>]*\brel=["']icon["']/iu.test(indexHtml)) {
    findings.push({
      category: 'structure',
      code: 'FAVICON_NOT_DECLARED',
      severity: 'error',
      message: 'index.html must declare an inline icon to prevent a default favicon request.',
      target: 'index.html',
    })
  }

  const routerSources = [
    fileContents.get('src/App.tsx'),
    fileContents.get('src/main.tsx'),
  ].filter((value): value is string => value !== undefined).join('\n')
  if (routerSources !== '' && (
    !routerSources.includes('HashRouter')
    || routerSources.includes('BrowserRouter')
  )) {
    findings.push({
      category: 'structure',
      code: 'ROUTER_CONTRACT_VIOLATION',
      severity: 'error',
      message: 'Generated React routes must use HashRouter and must not use BrowserRouter.',
      target: 'src/App.tsx',
    })
  }
  return findings
}

/** Aggregate stage outcomes without allowing a skipped browser stage to hide a build failure. */
function finalize(
  workspace: string,
  spec: TesterOutput,
  checks: readonly VerificationCheck[],
  findings: readonly VerificationFinding[],
  screenshots: readonly string[],
  incomplete: boolean,
): VerificationResult {
  const status = incomplete ? 'INCOMPLETE' : aggregateStatus(checks, findings)
  return {
    status,
    report: {
      verifier: 'future-cup-m3',
      status,
      failureSignature: createFailureSignature(findings, workspace),
      checks: [...checks],
      findings: [...findings],
      routes: spec.pages.map(page => page.route),
      viewports: ['desktop', 'mobile'],
      screenshots: [...screenshots],
    },
  }
}

/** Parse one durable file value and leave malformed JSON to the caller's finding path. */
function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Resolve one aggregate verification status from checks and finding severity. */
function aggregateStatus(
  checks: readonly VerificationCheck[],
  findings: readonly VerificationFinding[],
): VerificationStatus {
  if (checks.some(check => check.status === 'FAIL') || findings.some(finding => finding.severity === 'error')) {
    return 'FAIL'
  }
  if (checks.some(check => check.status === 'SKIPPED')) return 'INCOMPLETE'
  if (checks.some(check => check.status === 'WARNING') || findings.some(finding => finding.severity === 'warning')) {
    return 'WARNING'
  }
  return 'PASS'
}
