import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyBrowser } from '../src/browser-verifier.ts'
import type { TesterOutput } from '../src/types.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const spec: TesterOutput = {
  summary: 'Fixture assertions',
  pages: [
    { pageId: 'dashboard', route: '/', navigationLabel: 'Dashboard', requiredText: ['Fixture Dashboard', 'Desktop Detail'] },
    { pageId: 'users', route: '/users', navigationLabel: 'Users', requiredText: ['Fixture Dashboard', 'Desktop Detail'] },
  ],
  interactions: [
    {
      fromRoute: '/',
      clickText: 'Users',
      expectedRoute: '/users',
      expectedText: 'Fixture Dashboard',
    },
  ],
}

function fixture(options: {
  readonly content?: string
  readonly script?: string
}): string {
  const root = mkdtempSync(join(tmpdir(), 'future-cup-browser-'))
  roots.push(root)
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', 'index.html'), [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>Fixture</title><style>@media(max-width:640px){.desktop-only{display:none}}</style></head>',
    '<body>',
    '<div id="root">',
    `  <span style="display:none">${options.content ?? 'Fixture Dashboard'}</span>`,
    `  <main><h1>${options.content ?? 'Fixture Dashboard'}</h1><p class="desktop-only">Desktop Detail</p><nav aria-label="Sidebar"><a href="#/">Dashboard</a><a href="#/users">Users</a></nav><nav aria-label="Primary"><a href="#/">Dashboard</a><a href="#/users">Users</a></nav></main>`,
    '</div>',
    options.script ?? '',
    '</body>',
    '</html>',
  ].join('\n'))
  return root
}

describe('Playwright browser verification', () => {
  it('accepts a rendered page and navigation interaction in desktop and mobile viewports', {
    timeout: 60_000,
  }, async () => {
    const root = fixture({})
    const result = await verifyBrowser(root, spec, { timeoutMs: 10_000 })
    expect(result.status).toBe('PASS')
    expect(result.checks.filter(check => check.status === 'PASS')).toHaveLength(4)
    expect(result.viewports).toEqual(['desktop', 'mobile'])
  })

  it('rejects page errors, console errors, Ant Design deprecations, and 404 responses', {
    timeout: 60_000,
  }, async () => {
    const root = fixture({
      script: [
        '<script>',
        'setTimeout(() => { throw new Error("injected page error") }, 0)',
        'console.error("injected console error")',
        'console.warn("Warning: [antd: Card] bordered is deprecated")',
        '</script>',
        '<img src="/missing.png" alt="missing fixture" />',
      ].join('\n'),
    })
    const result = await verifyBrowser(root, spec, { timeoutMs: 10_000 })
    expect(result.status).toBe('FAIL')
    expect(result.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'PAGE_ERROR',
      'CONSOLE_ERROR',
      'ANTD_DEPRECATION_WARNING',
      'HTTP_ERROR_RESPONSE',
    ]))
  })
})
