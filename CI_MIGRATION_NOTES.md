# CI Migration Notes

Audit date: 2026-11-25. This fork no longer runs the inherited upstream CI lanes. This note preserves the prerequisites needed to rebuild a minimal CI from scratch.

## What was removed

- Round 1 (already pushed): `.github/workflows/ci.yml`, `.github/workflows/ci-windows.yml`, and `scripts/ci-compatible-selfhosted.spec.ts`; their workflow assertions in `scripts/ci-workflow.spec.ts`, `scripts/tests/ci-master-platforms.spec.ts`, and `scripts/client-build-environment.client.spec.ts` were trimmed at the same time.
- Round 2 (committed, not pushed): `.github/workflows/node-addon-system.yml`, `.github/workflows/pi-ai-provider-e2e.yml`, and `.github/dependabot.yml`. These three had no references in local gates or tests.

## What was intentionally kept

The remaining workflows are read by local gate tests under `scripts/**/*.spec.ts` (run by `pnpm test`) or are release/packaging entry points. Removing them requires editing those tests first, which the removal task did not include.

- Build and scheduling: `ci-master.yml`, `release-vendor.yml`, `expected-filenames.yml`, `sandbox.yml`
- Approval and policy: `weighted-approval.yml`, `weighted-approval-review-event.yml`, `pr-check-on-head-branch.yml`, `pr-check-after-approve.yml`, `pr-check-on-base-branch.yml`
- Release and packaging: `release-publish.yml`, `release-vendor-publish.yml`, `node-addon-system-release.yml`, `publish-ssh-helper.yml`, `python-release.yml`, `docs-pages.yml`, `windows-package.yml`, `macos-package.yml`, `macos-intel-package.yml`, `desktop-publish.yml`
- Reusable builders: `build-exe-for-python-sdk.yml`, `build-exe-for-ssh-helper.yml`
- GitLab: `.gitlab-ci.yml`
- Approval policy implementation: `.github/review-ownership/` (referenced by the `approval-policy` local gate and by `pnpm run test:approval-policy`)

## Toolchain

- Node 24; `package.json` requires `>=24.9.0`.
- pnpm 11.28.5 through corepack.
- Python 3.10 for the SDK and release lanes.
- uv 0.11.23 for Python release tooling.

## System packages

- `bubblewrap` for the sandbox e2e lane.
- `musl-tools` for musl/static builds.
- `wine` for the Windows-on-Linux gate; install with `--no-install-recommends`.
- Playwright browsers: `chromium` and `webkit` for the Future Cup UI.

## Commands and flags

- Install: `pnpm install --frozen-lockfile`.
- Typecheck: `pnpm run typecheck`.
- Lint: `pnpm run lint`.
- Unit tests: `pnpm test`.
- Fork acceptance: `pnpm run check:web`.
- Host compile heap: `--max-old-space-size=8192`.
- Windows ReFS installs: `--package-import-method=clone`; use the plain install on NTFS.
- Native Windows test lane: `--no-file-parallelism --testTimeout 90000`.
- Single-executable build: `DSH_BUILD_CLIENT_PROFILE=official`; PR mode adds `--build-artifacts`.

## Environment variables

- `DSH_TELEMETRY_DISABLED=1`.
- `DSH_GATE_FAIL_FAST=1` for fail-fast aggregate lanes.
- `DSH_COVERAGE_TEST_TIMEOUT_MS=90000` for shared-host lanes.
- `DSH_COVERAGE_PARTITIONS` and `DSH_COVERAGE_MAX_WORKERS` for partitioned coverage.
- `DSH_PUBLINT_CONCURRENCY`, `DSH_OXLINT_THREADS`, `DSH_GATE_CONCURRENCY`, `DSH_SNAPSHOT_MAX_CONCURRENCY`, `DSH_E2E_MAX_WORKERS`.
- `NODE_COMPILE_CACHE=${{ runner.temp }}/node-compile-cache` before the first pnpm call.
- Real-API e2e: `DSH_PI_AI_OPENAI_BASE_URL`, `DSH_PI_AI_OPENAI_MODEL`, `DSH_PI_AI_ANTHROPIC_MODEL`.

## Runners

- Hosted: `ubuntu-latest`, `ubuntu-24.04`, `windows-2025`, `macos-latest`, `macos-15-large`, `macos-15-xlarge`, `macos-15-intel`.
- Self-hosted labels: `["self-hosted","linux","x64","vm-backup"]`, `["self-hosted","dsh-win-ci","windows"]`, `dsh-win-package-trial`, `["self-hosted","macOS","ARM64","dsh-mac-package-trial"]`.
- Optional Blacksmith failover pools with 2/4/8/16 vCPU tiers.
- No service containers are required.

## Secrets and publishing

- `DEEPSEEK_API_KEY_EXTERNAL` for the real-API e2e lane.
- `NODE_AUTH_TOKEN` for npm publication.
- PyPI trusted publishing through `pypa/gh-action-pypi-publish`.
- GitHub App token for the approval decision check.
- Tag gates: `dsh-v*` for dsh releases, `vendor-*` for vendor releases, `python-v*` for Python releases, `node-addon-system-v*` for native addon releases.

## Caches

- pnpm store keyed by `pnpm-lock.yaml`.
- Playwright browser cache.
- Coverage duration history keyed by platform and runner pool.
- Node compile cache on the data volume.

## Minimal CI skeleton

If CI is rebuilt, start with one `ubuntu-latest` job: checkout, `pnpm/action-setup`, `actions/setup-node` with Node 24, `corepack pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test`. Add Windows and coverage lanes only when needed.

## Known local limitations on this Windows host

`pnpm run check:ci:snapshot` fails here even after the official-profile build. The Linux CI job `node 24 / snapshots and artifacts` passed on the same commit, and the win32 lane never ran the snapshot corpus, so this is an existing platform gap rather than a regression. Observed causes: Windows temp cwd spellings are not tokenized in some ACP/SDK session logs, one tool-schema snapshot path is parsed as JSON instead of read as a file, and some headless/SDK replays miss their fixture and reach the real API with `snapshot-replay-key`.

`DSH_EXAMPLE_MODE=lib pnpm run test:expected` also fails on this host (19 of 55 tests). The mismatches are platform-shaped: for example, the assembled catalog contains the Windows-only `diagnose-windows-sandbox-acl` skill while the committed inline snapshot records no catalog. The Linux `snapshots and artifacts` job passed the same suites on the same commit. Treat both suites as Linux-verified only; do not expect `check:all` to pass on this Windows host.

The fork's acceptance gate is `pnpm run check:web`; the local gates that pass on this host are `typecheck`, `lint`, `test` (46,793 passed with the fixed `windows-shell` spec), `check:web`, `build`, `doc-sync`, `hygiene`, `i18n`, `duplication`, `test:approval-policy`, and the markdown/translation gates.

The minimal pull-request CI runs only the documentation and approval checks; code gates and the full unit suite remain local.

## Minimal CI

`.github/workflows/ci-minimal.yml` runs on pull requests and manual dispatch: a full-history checkout, `pnpm install --frozen-lockfile`, `verify-md-wrap`, `verify-translation-pairing`, `verify-md-links`, `verify-repository-references`, and `test:approval-policy`. The first run completed green in 1m51s. It intentionally does not run `typecheck`, `lint`, `check:web`, the full unit suite, or the Linux-only snapshot and expected suites; those remain local gates.

## GitHub settings

- `main` has no branch protection and no rulesets, so no required status checks need to be cleared.
- The minimal pull-request workflow `ci-minimal.yml` is active; its check is `ci-minimal`.
- `weighted-approval`, `release-vendor`, and `node-addon-system` were disabled manually before this change; `node-addon-system.yml` is now deleted from the branch.
- `origin/main` still carries all upstream workflows until this branch is merged.

## Rollback

- Round 2 (committed, not pushed): revert the round-2 commit to restore the three deleted files and drop this note.
- Round 1 (pushed): revert the round-1 commit to restore `ci.yml`, `ci-windows.yml`, and `scripts/ci-compatible-selfhosted.spec.ts` together with the test wiring.
