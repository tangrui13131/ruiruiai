import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('preserves an existing source snapshot while filling missing scaffold files', () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-upgrade-scaffold-'))
    roots.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"name":"existing"}\n')
    writeFileSync(join(root, 'src', 'App.tsx'), 'export const App = () => <main>v1</main>\n')

    writeProjectScaffold(root, { overwrite: false })

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('existing')
    expect(readFileSync(join(root, 'src', 'App.tsx'), 'utf8')).toContain('v1')
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain("base: './'")
  })
})
