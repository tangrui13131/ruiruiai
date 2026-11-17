/** Detects generated source files that the production bundle bypasses. */

import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { VerificationFinding } from './types.ts'

const MANIFEST_FILE = 'module-manifest.txt'

/** One source file that never reached the production bundle. */
export interface BypassedSource {
  readonly path: string
  readonly kind: 'script' | 'stylesheet'
}

/**
 * Read the module manifest that the generated Vite config writes during a build.
 * @param workspace - generated project root.
 * @returns bundled module identifiers, or an empty list when the manifest is absent.
 */
async function readBundledModules(workspace: string): Promise<string[]> {
  const manifest = await readFile(
    join(workspace, 'dist', MANIFEST_FILE),
    'utf8',
  ).catch(() => undefined)
  if (manifest === undefined) return []
  return manifest
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => line.replaceAll('\\', '/'))
}

/**
 * List the project's own script and stylesheet sources relative to the workspace.
 * @param workspace - generated project root.
 * @returns repository-relative source paths.
 */
async function listProjectSources(workspace: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const root = resolve(workspace, 'src')
  const found: string[] = []

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      const relativePath = relative(root, absolute).replaceAll('\\', '/')
      found.push(`src/${relativePath}`)
    }
  }

  await walk(root)
  return found.sort()
}

/**
 * Report source files that exist in the workspace but never reached the bundle.
 *
 * A file can be bypassed when a sibling module with the same basename shadows it:
 * Vite resolves `./pages/Comp` to `Comp.jsx` before `Comp.tsx`, so a Repair
 * Agent that writes a corrected `Comp.tsx` next to an existing `Comp.jsx`
 * changes nothing without ever failing the build.
 *
 * @param workspace - generated project root.
 * @returns one finding per bypassed source file.
 */
export async function findBypassedSources(
  workspace: string,
): Promise<VerificationFinding[]> {
  const bundled = await readBundledModules(workspace)
  if (bundled.length === 0) return []

  const bundledSet = new Set(bundled)
  const sources = await listProjectSources(workspace)
  const findings: VerificationFinding[] = []

  for (const source of sources) {
    if (source.endsWith('.d.ts')) continue
    const isStylesheet = source.endsWith('.css')
    if (!isStylesheet && !/\.(?:ts|tsx|js|jsx|mjs)$/u.test(source)) continue

    const wasBundled = [...bundledSet].some(module => module.endsWith(`/${source}`))
    if (wasBundled) continue

    const category = isStylesheet ? 'structure' : 'build'
    findings.push({
      category,
      code: isStylesheet ? 'STYLESHEET_NOT_BUNDLED' : 'SOURCE_NOT_BUNDLED',
      severity: 'error',
      message: isStylesheet
        ? `Generated stylesheet "${source}" is never imported, so the design tokens it declares have no effect on the rendered application. Import it from src/App.tsx, or remove the stylesheet if it is not part of the design.`
        : `Generated source "${source}" never reached the production bundle. A sibling module with the same basename may be shadowing it, so changes to this file have no effect. Return this exact path after fixing it, and remove the shadowing sibling.`,
      target: source,
    })
  }

  return findings
}
