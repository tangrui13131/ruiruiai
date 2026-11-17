/** Proves the shadowing and bundle-coverage guards catch the real .jsx/.tsx defect. */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findBypassedSources } from '../src/bundle-manifest.ts'
import { writeScopedFiles, writeProjectScaffold } from '../src/project-scaffold.ts'

describe('shadowing guard', () => {
  it('rejects a new .tsx beside an existing .jsx with the same basename', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-shadow-'))
    writeScopedFiles(workspace, [
      { path: 'src/pages/Components.jsx', content: 'export function Page() { return null }\n' },
    ], ['src/pages/'])

    expect(() => writeScopedFiles(workspace, [
      { path: 'src/pages/Components.tsx', content: 'export function Page() { return null }\n' },
    ], ['src/pages/'])).toThrow(/would shadow existing source/)
  })

  it('allows a rewrite of the same path', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-shadow-'))
    writeScopedFiles(workspace, [
      { path: 'src/pages/Components.tsx', content: 'export const a = 1\n' },
    ], ['src/pages/'])
    expect(() => writeScopedFiles(workspace, [
      { path: 'src/pages/Components.tsx', content: 'export const a = 2\n' },
    ], ['src/pages/'])).not.toThrow()
    expect(readFileSync(join(workspace, 'src/pages/Components.tsx'), 'utf8')).toContain('= 2')
  })

  it('allows different basenames', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-shadow-'))
    writeScopedFiles(workspace, [
      { path: 'src/pages/Components.tsx', content: 'export const a = 1\n' },
    ], ['src/pages/'])
    expect(() => writeScopedFiles(workspace, [
      { path: 'src/pages/Widgets.tsx', content: 'export const b = 1\n' },
    ], ['src/pages/'])).not.toThrow()
  })
})

describe('bundle coverage', () => {
  it('reports a source file that the bundle never included', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-bundle-'))
    mkdirSync(join(workspace, 'src', 'pages'), { recursive: true })
    mkdirSync(join(workspace, 'dist'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'pages', 'Components.tsx'), 'export const a = 1\n')
    writeFileSync(join(workspace, 'src', 'pages', 'Home.tsx'), 'export const b = 1\n')
    // The manifest mirrors a real Vite build that resolved Components.jsx first.
    writeFileSync(
      join(workspace, 'dist', 'module-manifest.txt'),
      [
        'C:/project/src/pages/Components.jsx',
        'C:/project/src/pages/Home.tsx',
        'C:/project/src/App.tsx',
      ].join('\n'),
    )

    const findings = await findBypassedSources(workspace)
    const targets = findings.map(finding => finding.target)
    expect(targets).toContain('src/pages/Components.tsx')
    expect(targets).not.toContain('src/pages/Home.tsx')
    expect(findings.find(f => f.target === 'src/pages/Components.tsx')?.code).toBe('SOURCE_NOT_BUNDLED')
  })

  it('reports a stylesheet that nothing imports', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-bundle-'))
    mkdirSync(join(workspace, 'src'), { recursive: true })
    mkdirSync(join(workspace, 'dist'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'design.css'), ':root { --app-accent: #000; }\n')
    writeFileSync(join(workspace, 'src', 'styles.css'), 'body { margin: 0; }\n')
    writeFileSync(
      join(workspace, 'dist', 'module-manifest.txt'),
      ['C:/project/src/styles.css', 'C:/project/src/main.tsx'].join('\n'),
    )

    const findings = await findBypassedSources(workspace)
    const stylesheet = findings.find(finding => finding.target === 'src/design.css')
    expect(stylesheet?.code).toBe('STYLESHEET_NOT_BUNDLED')
    expect(findings.find(finding => finding.target === 'src/styles.css')).toBeUndefined()
  })

  it('ignores type declaration files and reports nothing for a complete bundle', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-bundle-'))
    mkdirSync(join(workspace, 'src'), { recursive: true })
    mkdirSync(join(workspace, 'dist'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'vite-env.d.ts'), '/// <reference types="vite/client" />\n')
    writeFileSync(join(workspace, 'src', 'main.tsx'), 'export const a = 1\n')
    writeFileSync(
      join(workspace, 'dist', 'module-manifest.txt'),
      ['C:/project/src/main.tsx'].join('\n'),
    )

    expect(await findBypassedSources(workspace)).toEqual([])
  })

  it('returns no findings when the build produced no manifest', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'fc-bundle-'))
    writeProjectScaffold(workspace)
    expect(await findBypassedSources(workspace)).toEqual([])
  })
})
