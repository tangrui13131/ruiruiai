/** Deterministic React/Vite/Ant Design scaffold and scoped structured-file writer. */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import type { FilePlan } from './types.ts'
import type { UiDesignTokens } from './types.ts'

const BASE_FILES: Readonly<Record<string, string>> = {
  'package.json': `${JSON.stringify({
    name: 'future-cup-agent-generated-dashboard',
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      'build:types': 'tsc --noEmit',
      'build:bundle': 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      antd: '^5.24.0',
      '@ant-design/icons': '^5.6.1',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'react-router-dom': '^6.28.0',
    },
    devDependencies: {
      '@types/react': '^18.3.12',
      '@types/react-dom': '^18.3.1',
      '@vitejs/plugin-react': '^4.3.4',
      typescript: '~5.6.3',
      vite: '^6.0.1',
    },
  }, null, 2)}\n`,
  'tsconfig.json': `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      useDefineForClassFields: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
    },
    include: ['src', 'vite.config.ts'],
  }, null, 2)}\n`,
  'vite.config.ts': [
    "import { defineConfig } from 'vite'",
    "import react from '@vitejs/plugin-react'",
    "import type { Plugin } from 'vite'",
    '',
    '// Records every module that actually reached the production bundle so the',
    '// platform can prove that no source file was silently bypassed.',
    'function moduleManifest(): Plugin {',
    '  return {',
    "    name: 'future-cup-module-manifest',",
    '    generateBundle(_options, bundle) {',
    '      const modules: string[] = []',
    '      for (const chunk of Object.values(bundle)) {',
    "        if (!('modules' in chunk)) continue",
    '        for (const id of Object.keys(chunk.modules)) modules.push(id)',
    '      }',
    "      this.emitFile({ type: 'asset', fileName: 'module-manifest.txt', source: modules.join('\\n') })",
    '    },',
    '  }',
    '}',
    '',
    "export default defineConfig({ base: './', plugins: [react(), moduleManifest()] })",
    '',
  ].join('\n'),
  'index.html': [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <link rel="icon" href="data:," />',
    '    <title>Future Cup Agent Team</title>',
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n'),
  'src/main.tsx': [
    "import React from 'react'",
    "import ReactDOM from 'react-dom/client'",
    "import { App } from './App.tsx'",
    "import './styles.css'",
    '',
    "ReactDOM.createRoot(document.getElementById('root')!).render(",
    '  <React.StrictMode>',
    '    <App />',
    '  </React.StrictMode>,',
    ')',
    '',
  ].join('\n'),
  'src/App.tsx': [
    'export function App() {',
    '  return <main>Agent Team scaffold</main>',
    '}',
    '',
  ].join('\n'),
  'src/styles.css': [
    ':root { font-family: Inter, "Segoe UI", sans-serif; color: #17231c; background: #f4f7f5; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; min-width: 320px; min-height: 100vh; }',
    '',
  ].join('\n'),
  'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
}

/**
 * Create the deterministic project scaffold before role tasks run.
 * Existing files are replaced by default so each ordinary run starts from the same base.
 * @param workspace - generated project root.
 * @param options - set `overwrite` to false when upgrading an existing source snapshot.
 */
export function writeProjectScaffold(
  workspace: string,
  options: { readonly overwrite?: boolean } = {},
): void {
  const overwrite = options.overwrite ?? true
  for (const [path, content] of Object.entries(BASE_FILES)) {
    const target = resolve(workspace, path)
    if (!overwrite && existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

/** Source file extensions that can shadow one another through an extensionless import. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'] as const

/**
 * List sibling source files that would shadow the proposed path.
 *
 * Vite resolves `./pages/Comp` to `Comp.jsx` before `Comp.tsx`, so writing a
 * corrected `Comp.tsx` next to an existing `Comp.jsx` changes nothing. A
 * generated application must never contain two modules with one basename.
 * @param workspace - generated project root.
 * @param path - proposed repository-relative path.
 * @returns shadowing sibling paths relative to the workspace.
 */
function findShadowingSiblings(workspace: string, path: string): string[] {
  const extension = extname(path)
  if (!SOURCE_EXTENSIONS.includes(extension as (typeof SOURCE_EXTENSIONS)[number])) {
    return []
  }
  const base = path.slice(0, path.length - extension.length)
  const siblings: string[] = []
  for (const candidate of SOURCE_EXTENSIONS) {
    if (candidate === extension) continue
    const sibling = `${base}${candidate}`
    if (existsSync(resolve(workspace, sibling))) siblings.push(sibling)
  }
  return siblings.sort()
}

/**
 * Apply validated structured file plans without escaping the project workspace.
 * @param workspace - generated project root.
 * @param files - proposed source files.
 * @param allowedPrefixes - repository-relative prefixes this task may write.
 * @returns normalized written paths.
 */
export function writeScopedFiles(
  workspace: string,
  files: readonly FilePlan[],
  allowedPrefixes: readonly string[],
): string[] {
  const root = resolve(workspace)
  const written = new Set<string>()
  for (const file of files) {
    if (!file.path.startsWith('src/') || file.path.includes('..') || file.path.includes('\\')) {
      throw new Error(`Agent file path "${file.path}" is not a safe src/ path`)
    }
    if (!allowedPrefixes.some(prefix => file.path.startsWith(prefix))) {
      throw new Error(`Agent file path "${file.path}" is outside its allowed write scopes`)
    }
    const target = resolve(root, file.path)
    const relativePath = relative(root, target).replaceAll('\\', '/')
    if (relativePath.startsWith('../') || relativePath === '..' || target.includes(`${sep}..${sep}`)) {
      throw new Error(`Agent file path "${file.path}" escapes the project workspace`)
    }
    const shadows = findShadowingSiblings(root, file.path)
    if (shadows.length > 0) {
      throw new Error(
        `Agent file path "${file.path}" would shadow existing source ${shadows.join(', ')}. `
        + 'Modify the existing module instead of adding a second file with the same basename.',
      )
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content)
    written.add(relativePath)
  }
  return [...written].sort()
}

/**
 * Render the shared design stylesheet from compact Agent-selected tokens.
 * @param tokens - validated UI Designer token choices.
 * @returns deterministic CSS shared by every page.
 */
export function renderDesignStylesheet(tokens: UiDesignTokens): string {
  return [
    ':root {',
    `  --app-background: ${tokens.background};`,
    `  --app-surface: ${tokens.surface};`,
    `  --app-text: ${tokens.text};`,
    `  --app-muted: ${tokens.muted};`,
    `  --app-accent: ${tokens.accent};`,
    `  --app-border: ${tokens.border};`,
    `  --app-danger: ${tokens.danger};`,
    `  --app-font: ${tokens.fontFamily};`,
    `  --app-radius: ${tokens.cardRadius}px;`,
    `  --app-space: ${tokens.spacingUnit}px;`,
    '}',
    '',
    'body { margin: 0; background: var(--app-background); color: var(--app-text); font-family: var(--app-font); }',
    'button, input, textarea, select { font: inherit; }',
    '.app-shell { min-height: 100vh; background: var(--app-background); color: var(--app-text); }',
    '.app-nav { display: flex; gap: calc(var(--app-space) * 2); flex-wrap: wrap; padding: calc(var(--app-space) * 3); background: var(--app-surface); border-bottom: 1px solid var(--app-border); }',
    '.app-nav a { color: var(--app-muted); font-weight: 600; text-decoration: none; }',
    '.app-nav a[aria-current="page"] { color: var(--app-accent); }',
    '.page-shell { width: min(1180px, 100%); margin: 0 auto; padding: calc(var(--app-space) * 6) calc(var(--app-space) * 3); }',
    '.page-header { margin-bottom: calc(var(--app-space) * 5); }',
    '.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: calc(var(--app-space) * 3); }',
    '.metric-card, .ant-card, .ant-table-wrapper { border-color: var(--app-border); border-radius: var(--app-radius); }',
    '.status-danger { color: var(--app-danger); }',
    '@media (max-width: 640px) { .page-shell { padding: calc(var(--app-space) * 4) calc(var(--app-space) * 2); } }',
    '',
  ].join('\n')
}
