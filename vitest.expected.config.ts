import { availableParallelism } from 'node:os'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/** Owner-local assembled expected-output tests that do not use a recorded session as their input. */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-proxy-environment.ts'],
    include: [
      'apps/cli/tests/**/*.expected.e2e.ts',
    ],
    // The fork ships the Future Cup platform in place of the official web app.
    // These suites drive `default-web-process.ts`, which boots the removed
    // host-webserver stack and waits for its ready line, auth token, and public
    // URL; `check:web` covers the replacement product.
    exclude: ['apps/cli/tests/profiles/web/**'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    maxWorkers: Math.min(5, availableParallelism()),
  },
})
