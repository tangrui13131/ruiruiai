/**
 * Specs that drive packaging toolchains (git, PowerShell, installer builders, staged links).
 *
 * They belong to this repository — they assert its release pipeline invariants — but they must
 * not run in the default unit suite: a checkout without those toolchains would fail them for
 * environment reasons while the suite is expected to be fast, offline, and deterministic.
 * `pnpm run test:packaging` runs this list through `vitest.packaging.config.ts`.
 *
 * Pure manifest assertions (`desktop-package-forms`, `macos-package-workflow`) stay in the
 * default suite: they only parse workflow YAML.
 */
export const packagingToolchainTests = [
  'scripts/desktop-package-source.spec.ts',
  'scripts/executable-packaging.spec.ts',
  'scripts/build-exe-for-python-sdk.spec.ts',
  'scripts/windows-package-workflow.spec.ts',
] as const
