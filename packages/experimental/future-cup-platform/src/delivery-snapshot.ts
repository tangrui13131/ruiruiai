/** Immutable, browser-safe source snapshots used by derived project upgrades. */

import { existsSync, lstatSync } from 'node:fs'
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.golden-src',
  'dist',
  'node_modules',
  'screenshots',
])

/**
 * Resolve the immutable delivery snapshot stored beside one run workspace.
 * @param workspace - generated project workspace.
 * @returns the snapshot directory path.
 */
export function deliverySnapshotPath(workspace: string): string {
  return resolve(dirname(resolve(workspace)), 'delivery-snapshot')
}

/**
 * Persist a safe source snapshot for a future derived project.
 * @param workspace - verified generated project workspace.
 * @returns the immutable snapshot directory.
 */
export async function saveDeliverySnapshot(workspace: string): Promise<string> {
  const snapshot = deliverySnapshotPath(workspace)
  if (existsSync(snapshot)) return snapshot
  const temporary = `${snapshot}.tmp-${randomUUID()}`
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true, mode: 0o700 })
  try {
    await cp(resolve(workspace), temporary, {
      recursive: true,
      filter: source => shouldCopy(source, resolve(workspace)),
    })
    await rename(temporary, snapshot)
    return snapshot
  } catch (error: unknown) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

/**
 * Copy one persisted delivery snapshot into a fresh run workspace.
 * @param snapshot - source snapshot directory.
 * @param workspace - target generated project workspace.
 */
export async function copyDeliverySnapshot(snapshot: string, workspace: string): Promise<void> {
  if (!existsSync(snapshot)) {
    throw new Error(`Delivery snapshot does not exist at "${snapshot}"`)
  }
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  await cp(snapshot, workspace, {
    recursive: true,
    force: true,
    filter: source => shouldCopy(source, snapshot),
  })
}

function shouldCopy(source: string, root: string): boolean {
  const rel = relative(root, source)
  if (rel === '') return true
  const segments = rel.split(sep)
  if (segments.some(segment => EXCLUDED_SEGMENTS.has(segment))) return false
  if (isSecretFile(basename(source))) return false
  return !lstatSync(source).isSymbolicLink()
}

function isSecretFile(name: string): boolean {
  return name === '.env'
    || name.startsWith('.env.')
    || name === 'config.local.json'
    || name === 'settings.local.json'
    || name.endsWith('.local.json')
}
