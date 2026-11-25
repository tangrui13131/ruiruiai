# Gate probe failure excerpt
```
26:No test files found, exiting with code 1
34:== FAILED web browser snapshot (1.37s) ==
37:run-gates: fail-fast aborting: web browser snapshot failed.
41:  - FAILED web browser snapshot (1.37s, exit 1)
```
## Tail
```
$ tsx scripts/run-gates.ts ci-consumers
run-gates: worker settings {"DSH_OXLINT_THREADS":"2","DSH_PUBLINT_CONCURRENCY":"2","DSH_SNAPSHOT_MAX_WORKERS":"1","DSH_SNAPSHOT_MAX_CONCURRENCY":"2","DSH_WEB_SNAPSHOT_WORKERS":"4","DSH_COVERAGE_MAX_WORKERS":"4","DSH_COVERAGE_PARTITIONS":"3"}
run-gates: ci-consumers running 9 gate(s) with 4 worker(s) from 4 available CPU(s), fail-fast after first blocking failure.
run-gates: start build:artifacts
run-gates: start Node compatibility
run-gates: PASS build:artifacts (137.54s)
run-gates: start publint
run-gates: start test:snapshot
run-gates: start test:expected
run-gates: PASS publint (25.35s)
run-gates: start doc-typecheck:contracts-ready
run-gates: PASS doc-typecheck:contracts-ready (40.14s)
run-gates: start node-next types
run-gates: PASS Node compatibility (206.48s)
run-gates: start built-bin smoke
run-gates: PASS node-next types (7.14s)
run-gates: PASS test:expected (98.40s)
run-gates: PASS built-bin smoke (63.57s)
run-gates: PASS test:snapshot (203.81s)
run-gates: start web browser snapshot
$ tsx scripts/run-web-snapshots.ts
The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.11 /home/runner/work/ruiruiai/ruiruiai

No test files found, exiting with code 1

filter: apps/web/tests/hmr-live.e2e.ts
include: apps/web/tests/**/*.e2e.ts, apps/web/tests/**/*.snapshot.ts, packages/experimental/inspector/tests/client-browser.e2e.ts
exclude:  **/node_modules/**, **/.git/**

[ELIFECYCLE] Command failed with exit code 1.

== FAILED web browser snapshot (1.37s) ==
command: DSH_SNAPSHOT=replay DSH_WEB_SNAPSHOT_WORKERS=4 pnpm run test:web:ci
outcome: exit 1
run-gates: fail-fast aborting: web browser snapshot failed.

run-gates: 8 passed, 1 failed, 0 skipped in 342.72s.
run-gates: unsuccessful gates:
  - FAILED web browser snapshot (1.37s, exit 1)
    DSH_SNAPSHOT=replay DSH_WEB_SNAPSHOT_WORKERS=4 pnpm run test:web:ci
[ELIFECYCLE] Command failed with exit code 1.
```
