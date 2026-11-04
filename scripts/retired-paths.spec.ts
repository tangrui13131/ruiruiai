import { describe, expect, it } from 'vitest'
import { isRetiredOfficialFrontendPath } from './retired-paths.ts'

describe('retired official frontend paths', () => {
  it('recognizes historical frontend directories and files', () => {
    expect(isRetiredOfficialFrontendPath('apps/desktop/README.md')).toBe(true)
    expect(isRetiredOfficialFrontendPath('apps/desktop-host/src/main.ts')).toBe(true)
    expect(isRetiredOfficialFrontendPath('apps/web/tests/boot.e2e.ts')).toBe(true)
    expect(isRetiredOfficialFrontendPath('benchmarks/long-session-browser/README.md')).toBe(true)
    expect(isRetiredOfficialFrontendPath('website/docs.ts')).toBe(true)
    expect(isRetiredOfficialFrontendPath('scripts/project-doc-site.ts')).toBe(true)
    expect(isRetiredOfficialFrontendPath('./scripts/web-product-bundle-isolation.ts')).toBe(true)
  })

  it('does not classify maintained package or application paths as retired', () => {
    expect(isRetiredOfficialFrontendPath('apps/cli/src/bin.ts')).toBe(false)
    expect(isRetiredOfficialFrontendPath('packages/experimental/future-cup-platform/src/server.ts')).toBe(false)
  })
})
