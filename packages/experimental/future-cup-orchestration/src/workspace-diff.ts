/** Read and compare generated source files without relying on repository Git state. */

import { createTwoFilesPatch } from 'diff'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.css', '.json', '.ts', '.tsx'])

/**
 * Read the generated project's bounded source tree.
 * @param workspace - generated project root.
 * @returns normalized source paths mapped to exact UTF-8 contents.
 */
export async function readWorkspaceSourceSnapshot(workspace: string): Promise<Map<string, string>> {
  const root = resolve(workspace, 'src')
  const files = new Map<string, string>()
  await visit(root, root, files)
  return new Map([...files].sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Create a deterministic unified patch between two source snapshots.
 * @param before - source contents before the Repair Agent output.
 * @param after - source contents after bounded file application.
 * @returns one concatenated unified diff, or an empty string when nothing changed.
 */
export function createWorkspaceDiff(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort()
  return paths.flatMap((path) => {
    const previous = before.get(path) ?? ''
    const next = after.get(path) ?? ''
    if (previous === next) return []
    return [createTwoFilesPatch(path, path, previous, next, 'before', 'after', { context: 3 })]
  }).join('\n')
}

/** Recursively collect regular source files and reject path escapes. */
async function visit(root: string, directory: string, files: Map<string, string>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    throw new Error(`cannot read generated source directory "${directory}": ${String(error)}`)
  })
  for (const entry of entries) {
    const target = resolve(directory, entry.name)
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error(`generated source path "${target}" escapes the workspace`)
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`generated source symlink "${target}" is not verifiable`)
    }
    if (entry.isDirectory()) {
      await visit(root, target, files)
      continue
    }
    if (!entry.isFile()) continue
    const extension = entry.name.slice(entry.name.lastIndexOf('.'))
    if (!SOURCE_EXTENSIONS.has(extension)) continue
    const path = relative(resolve(root, '..'), target).replaceAll('\\', '/')
    if (!path.startsWith('src/')) throw new Error(`generated source path "${path}" is outside src/`)
    files.set(path, await readFile(target, 'utf8'))
  }
}
