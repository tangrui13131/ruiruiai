import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeProjectScaffold } from '../src/project-scaffold.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('project scaffold', () => {
  it('uses relative Vite assets so the production build works below the platform preview path', () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-scaffold-'))
    roots.push(root)
    writeProjectScaffold(root)
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8'))
      .toContain("base: './'")
  })
})
