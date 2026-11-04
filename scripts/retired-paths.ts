/** Repository paths retired with the official Web and Desktop frontends. */

const RETIRED_PREFIXES = [
  'apps/desktop/',
  'apps/desktop-host/',
  'apps/web/',
  'benchmarks/long-session-browser/',
  'website/',
] as const

const RETIRED_FILES = new Set([
  'scripts/project-doc-site.ts',
  'scripts/web-product-bundle-isolation.ts',
])

/**
 * Whether one repository-relative path belonged to a retired official frontend.
 * @param path - forward-slash repository path.
 * @returns true for historical frontend paths retained only in documentation.
 */
export function isRetiredOfficialFrontendPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//u, '')
  return RETIRED_PREFIXES.some(prefix => normalized.startsWith(prefix))
    || RETIRED_FILES.has(normalized)
}
