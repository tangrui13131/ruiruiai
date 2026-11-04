import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyDeliverySnapshot,
  deliverySnapshotPath,
  saveDeliverySnapshot,
} from '../src/delivery-snapshot.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('delivery snapshots', () => {
  it('copies safe project sources without dependencies, builds, secrets, or links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-delivery-snapshot-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    mkdirSync(join(workspace, 'src'), { recursive: true })
    mkdirSync(join(workspace, 'node_modules', 'dependency'), { recursive: true })
    mkdirSync(join(workspace, 'dist'), { recursive: true })
    writeFileSync(join(workspace, 'package.json'), '{"name":"snapshot"}\n')
    writeFileSync(join(workspace, 'src', 'App.tsx'), 'export const App = () => null\n')
    writeFileSync(join(workspace, 'node_modules', 'dependency', 'index.js'), 'ignored\n')
    writeFileSync(join(workspace, 'dist', 'index.html'), 'ignored\n')
    writeFileSync(join(workspace, '.env'), 'SECRET=ignored\n')
    const snapshot = await saveDeliverySnapshot(workspace)

    expect(snapshot).toBe(deliverySnapshotPath(workspace))
    await expect(saveDeliverySnapshot(workspace)).resolves.toBe(snapshot)
    expect(readFileSync(join(snapshot, 'package.json'), 'utf8')).toContain('snapshot')
    expect(readFileSync(join(snapshot, 'src', 'App.tsx'), 'utf8')).toContain('App')
    expect(() => readFileSync(join(snapshot, '.env'), 'utf8')).toThrow()
    expect(() => readFileSync(join(snapshot, 'node_modules', 'dependency', 'index.js'), 'utf8'))
      .toThrow()
    expect(() => readFileSync(join(snapshot, 'dist', 'index.html'), 'utf8')).toThrow()
  })

  it('restores a snapshot into a fresh workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-delivery-restore-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'App.tsx'), 'export const App = () => null\n')
    const snapshot = await saveDeliverySnapshot(workspace)
    const target = join(root, 'upgrade-workspace')

    await copyDeliverySnapshot(snapshot, target)

    expect(readFileSync(join(target, 'src', 'App.tsx'), 'utf8')).toContain('App')
  })

  it('rejects missing snapshots and cleans failed temporary copies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-delivery-errors-'))
    roots.push(root)
    const missing = join(root, 'missing-workspace')
    await expect(copyDeliverySnapshot(
      join(root, 'missing-snapshot'),
      join(root, 'target'),
    )).rejects.toThrow(/does not exist/)
    await expect(saveDeliverySnapshot(missing)).rejects.toThrow()
    expect(existsSync(deliverySnapshotPath(missing))).toBe(false)
  })
})
