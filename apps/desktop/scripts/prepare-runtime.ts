/** Prepare the self-contained Future Cup runtime closure for the desktop shell. */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { glob, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  deduplicateStagedWorkspacePackages,
  materializeStagedLinks,
} from '../../../scripts/build-exe-for-python-sdk-staging.ts'

const appRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(appRoot, '../..')
const runtimeRoot = resolve(appRoot, 'runtime')
// electron-builder skips the root node_modules of an extraResources source;
// nest the closure so node_modules is a child directory it will copy.
const target = resolve(runtimeRoot, 'app')

const npmExecPath = process.env.npm_execpath?.trim()
const usesNodeEntrypoint = npmExecPath !== undefined && npmExecPath !== ''
const command = usesNodeEntrypoint ? process.execPath : 'pnpm.cmd'
const shell = !usesNodeEntrypoint

function runPnpm(label: string, args: string[]): void {
  const result = spawnSync(command, usesNodeEntrypoint ? [npmExecPath, ...args] : args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${String(result.status)}`)
}

async function main(): Promise<void> {
  rmSync(runtimeRoot, { recursive: true, force: true })

  runPnpm('runtime deploy', [
    '--filter', 'dsh-desktop-runtime-closure',
    'deploy', '--legacy', '--prod',
    '--config.allow-unused-patches=true',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=true',
    '--config.hoist-workspace-packages=true',
    '--config.link-workspace-packages=true',
    target,
  ])

  // Legacy deploy records production-only workspace state; restore the checkout before using it again.
  try {
    runPnpm('development restore', [
      'install', '--offline', '--frozen-lockfile', '--prod=false', '--ignore-scripts',
    ])
  } catch (error) {
    console.warn(`warning: failed to restore development dependencies: ${String(error)}`)
  }

  await materializeStagedLinks(target)
  await deduplicateStagedWorkspacePackages(target, repoRoot)

  let pruned = 0
  for (const pattern of ['node_modules/**/*.map', 'node_modules/**/*.d.ts', 'node_modules/**/*.d.mts', 'node_modules/**/*.d.cts']) {
    for await (const file of glob(pattern, { cwd: target })) {
      await rm(resolve(target, file), { force: true })
      pruned += 1
    }
  }
  console.log(`desktop runtime: pruned ${String(pruned)} source-map/declaration files`)

  const entry = resolve(target, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  if (!existsSync(entry)) throw new Error(`runtime closure is missing ${entry}`)
  console.log(`desktop runtime ready: ${target}`)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
