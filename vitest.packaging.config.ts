import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { packagingToolchainTests } from './scripts/packaging-tests.ts'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// Packaging lane: separate from the default unit suite because these specs spawn
// git, PowerShell, and installer builders. Serial file execution keeps concurrent
// installer builds from contending for the shared electron-builder cache.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-proxy-environment.ts'],
    include: [...packagingToolchainTests],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
