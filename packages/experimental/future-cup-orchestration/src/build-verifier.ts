/** Independent dependency, TypeScript, and Vite build verification. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { normalizeVerificationMessage } from './failure-signature.ts'
import type {
  VerificationCheck,
  VerificationFinding,
  VerificationStatus,
} from './types.ts'

const execFileAsync = promisify(execFile)

/** One deterministic command result retained by the build verifier. */
export interface VerificationCommandResult {
  readonly command: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Command execution seam used by focused verifier tests. */
export interface VerificationCommandRunner {
  /**
   * Run one generated-project command.
   * @param command - executable label.
   * @param args - exact argument list.
   * @param workspace - generated project root.
   * @param timeoutMs - command deadline.
   * @returns the settled command evidence.
   */
  run(
    command: string,
    args: readonly string[],
    workspace: string,
    timeoutMs: number,
  ): Promise<VerificationCommandResult>
}

/** Aggregated deterministic build verification without cross-stage aggregation. */
export interface BuildVerification {
  readonly status: Exclude<VerificationStatus, 'WARNING' | 'INCOMPLETE'>
  readonly checks: readonly VerificationCheck[]
  readonly findings: readonly VerificationFinding[]
  readonly steps: readonly VerificationCommandResult[]
}

/** Explicit build verifier bounds. */
export interface BuildVerifierOptions {
  readonly timeoutMs: number
  readonly runner?: VerificationCommandRunner
}

/** Production command runner that never invokes an unowned shell command. */
export const localVerificationCommandRunner: VerificationCommandRunner = {
  async run(command, args, workspace, timeoutMs) {
    const executable = process.platform === 'win32' && command === 'npm'
      ? process.env.ComSpec ?? 'cmd.exe'
      : command
    const executableArgs = process.platform === 'win32' && command === 'npm'
      ? ['/d', '/s', '/c', `npm ${args.join(' ')}`]
      : [...args]
    try {
      const result = await execFileAsync(executable, executableArgs, {
        cwd: workspace,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      })
      return {
        command: `${command} ${args.join(' ')}`,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    } catch (error: unknown) {
      const failure = error as {
        code?: number | string
        stdout?: string
        stderr?: string
        message?: string
      }
      return {
        command: `${command} ${args.join(' ')}`,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? failure.message ?? String(error),
      }
    }
  },
}

/**
 * Install generated dependencies, typecheck, and create the Vite production bundle.
 * @param workspace - generated project root.
 * @param options - explicit timeout and command runner.
 * @returns stage evidence and deterministic findings.
 */
export async function verifyProjectBuild(
  workspace: string,
  options: BuildVerifierOptions,
): Promise<BuildVerification> {
  const runner = options.runner ?? localVerificationCommandRunner
  const steps: VerificationCommandResult[] = []
  const checks: VerificationCheck[] = []
  const findings: VerificationFinding[] = []

  const install = await runner.run(
    'npm',
    ['install', '--no-audit', '--no-fund'],
    workspace,
    options.timeoutMs,
  )
  steps.push(install)
  if (install.exitCode === 0) {
    checks.push({ name: 'dependency-install', status: 'PASS', summary: 'Dependencies installed.' })
  } else {
    checks.push({ name: 'dependency-install', status: 'FAIL', summary: 'Dependency installation failed.' })
    findings.push(commandFinding('dependency', 'DEPENDENCY_INSTALL_FAILED', install, workspace))
    return { status: 'FAIL', checks, findings, steps }
  }

  const typecheck = await runner.run(
    'npm',
    ['run', 'build:types'],
    workspace,
    options.timeoutMs,
  )
  steps.push(typecheck)
  if (typecheck.exitCode === 0) {
    checks.push({ name: 'typescript', status: 'PASS', summary: 'TypeScript completed without errors.' })
  } else {
    checks.push({ name: 'typescript', status: 'FAIL', summary: 'TypeScript reported errors.' })
    findings.push(...typescriptFindings(typecheck, workspace))
  }

  const build = await runner.run(
    'npm',
    ['run', 'build:bundle'],
    workspace,
    options.timeoutMs,
  )
  steps.push(build)
  if (build.exitCode === 0) {
    checks.push({ name: 'vite-build', status: 'PASS', summary: 'Vite production build completed.' })
  } else {
    checks.push({ name: 'vite-build', status: 'FAIL', summary: 'Vite production build failed.' })
    findings.push(commandFinding('build', 'VITE_BUILD_FAILED', build, workspace))
  }

  return {
    status: findings.some(finding => finding.severity === 'error') ? 'FAIL' : 'PASS',
    checks,
    findings,
    steps,
  }
}

/** Build one generic command failure with a bounded actionable diagnostic. */
function commandFinding(
  category: VerificationFinding['category'],
  code: string,
  result: VerificationCommandResult,
  workspace: string,
): VerificationFinding {
  return {
    category,
    code,
    severity: 'error',
    message: normalizeVerificationMessage(
      [result.stderr, result.stdout].filter(Boolean).join('\n').slice(-8_000),
      workspace,
    ),
    target: result.command,
  }
}

/** Extract TypeScript error identities instead of collapsing them into command failure. */
function typescriptFindings(
  result: VerificationCommandResult,
  workspace: string,
): VerificationFinding[] {
  const output = [result.stderr, result.stdout].filter(Boolean).join('\n')
  const pattern = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gmu
  const findings = [...output.matchAll(pattern)].map(match => ({
    category: 'typescript' as const,
    code: match[4] ?? 'TS_ERROR',
    severity: 'error' as const,
    message: normalizeVerificationMessage(match[5] ?? 'TypeScript error', workspace),
    target: (match[1] ?? '<unknown>').replaceAll('\\', '/'),
  }))
  return findings.length > 0
    ? findings
    : [commandFinding('typescript', 'TYPESCRIPT_FAILED', result, workspace)]
}
