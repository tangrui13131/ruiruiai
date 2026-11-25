# Repository health score

English | [中文](repo-health.zh.md)

Every commit must leave the repository health score at or above the baseline recorded here. The baseline is **83/100** (2026-11-25); change it only in a commit that deliberately moves it, with the user's approval and the rationale in that commit.

## Dimensions

| Dimension | Weight | Earned by |
|---|---:|---|
| Code and build health | 30 | `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `pnpm run check:web` pass |
| Local test health | 25 | The full unit suite passes on this host; Linux-verified `test:snapshot` and `test:expected` show no new failures |
| Local check integrity | 15 | Hooks, `scripts/run-gates.ts`, `package.json` checks, and Makefile targets stay intact; no check is skipped, weakened, or excluded to raise the score |
| Remote assurance | 20 | Pull-request CI and branch protection run the checks; this fork has neither, capping the dimension at 6 |
| Repository hygiene and rollback | 10 | Clean working tree, logical commits, resolvable documentation links, translation sidecars in sync, documented limitations and rollback path |

## Health floor

Run this floor before every commit and the full floor before merging to `main` or creating a release:

```sh
pnpm run typecheck
pnpm run lint
pnpm run check:web
pnpm test
pnpm run build
```

Run the focused suites for every changed area, and `pnpm exec tsx scripts/run-gates.ts doc-sync` when documentation, Agent Notes, or translation sidecars change.

## Scoring and enforcement

- Compute the score from command output and repository state, not from intent; print the five dimension scores with their evidence before committing.
- Reject a commit whose score is below the baseline. Fix the regression, split the commit, or obtain explicit user approval and update the baseline in the same commit.
- Never raise the score by deleting, skipping, weakening, or excluding tests, type checks, lint rules, coverage thresholds, or translation checks.
- Record the commands run and their results in the commit message or pull-request description.
- Stop and ask when the working tree is dirty before the health check; do not mix unrelated changes into a health commit.

## Host limitations

The `test:snapshot` and `test:expected` suites are Linux-verified only; their Windows failures are recorded in [CI_MIGRATION_NOTES.md](../CI_MIGRATION_NOTES.md) and do not by themselves lower the score, but they must not regress on Linux. The fork has no pull-request CI or branch protection, so the local floor is the only merge signal and the remote-assurance dimension stays at 6 until CI is restored.

## Current baseline

83/100: code 29, tests 23, checks 15, remote 6, hygiene 10. Reach 90 by pushing the local commits, adding a minimal `ubuntu-latest` CI for typecheck, lint, and tests, and completing the Linux verification of the snapshot and expected suites.
