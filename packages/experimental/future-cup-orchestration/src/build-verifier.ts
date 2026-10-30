/** Independent deterministic TypeScript and Vite build verifier. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { JsonValue, VerificationStatus } from './types.ts'

const execFileAsync = promisify(execFile)

/** One completed deterministic build command. */
export interface BuildStepResult {
  readonly command: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Aggregated deterministic verification report. */
export interface BuildVerification {
  readonly status: VerificationStatus
  readonly report: JsonValue
}

/**
 * Install dependencies and run the generated project's TypeScript/Vite build.
 * @param workspace - generated project root.
 * @param timeoutMs - bound for each npm command.
 * @returns deterministic command evidence and a PASS/FAIL verdict.
 */
export async function verifyProjectBuild(
  workspace: string,
  timeoutMs = 600_000,
): Promise<BuildVerification> {
  const steps: BuildStepResult[] = []
  for (const [command, args] of [
    ['npm install', ['install', '--no-audit', '--no-fund']],
    ['npm run build', ['run', 'build']],
  ] as const) {
    try {
      const executable = process.platform === 'win32'
        ? process.env.ComSpec ?? 'cmd.exe'
        : 'npm'
      const executableArgs = process.platform === 'win32'
        ? ['/d', '/s', '/c', `npm ${args.join(' ')}`]
        : args
      const result = await execFileAsync(executable, executableArgs, {
        cwd: workspace,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      })
      steps.push({
        command,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      })
    } catch (error: unknown) {
      const failure = error as {
        code?: number | string
        stdout?: string
        stderr?: string
        message?: string
      }
      steps.push({
        command,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? failure.message ?? String(error),
      })
      break
    }
  }
  const passed = steps.length === 2 && steps.every(step => step.exitCode === 0)
  return {
    status: passed ? 'PASS' : 'FAIL',
    report: {
      verifier: 'typescript-and-vite',
      passed,
      steps: steps.map(step => ({
        command: step.command,
        exitCode: step.exitCode,
        stdout: step.stdout,
        stderr: step.stderr,
      })),
    },
  }
}
