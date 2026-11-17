# Agent Note: Windows portable packaging and pnpm deploy symlink dereferencing

Status: implemented

English | [中文](2026-11-14-windows-portable-pnpm-deploy-dereferencing.zh.md)

## Problem

Packaging `@deepseek-ai/dsh` and `@deepseek-ai/dsh-experimental-future-cup-platform` into a relocatable Windows portable directory with `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod --config.node-linker=hoisted` omits transitive workspace `peerDependencies` (such as `@deepseek-ai/dsh-host-plugin-inventory`, `@deepseek-ai/dsh-scope`, and `@deepseek-ai/dsh-attachment`) and creates Windows NTFS directory junctions (such as `@deepseek-ai/schemastery` pointing back to the repository `vendor/schemastery` directory). Smoke-testing inside the build host passes because Node resolves the junction back to the source repository, whereas archiving with `tar.exe` and extracting onto another path or machine drops the junction target and fails startup with `ERR_MODULE_NOT_FOUND`.

## Decision

Every relocatable Windows portable bundle for `@deepseek-ai/dsh` and `future-cup-platform` must materialize a self-contained directory without any symlinks or directory junctions before archiving.

After `pnpm deploy --legacy --prod --config.node-linker=hoisted`, the packaging step copies all missing Windows-compatible workspace packages (`packages/*/*`, `vendor/*`, and `native/system/packages/win32-x64`) into flat `app/node_modules/<pkgName>` using dereferenced file copies (excluding `node_modules`, `src`, `tests`, `ui`, and `.tsbuildinfo`), replaces any existing `ReparsePoint` junction under `app/node_modules` (including `@deepseek-ai/schemastery`) with a physical copy of `package.json` and `lib/`, and verifies that a recursive `lstat` / `ReparsePoint` scan reports zero symbolic links or junctions across both `app` and `runtime`.

The Windows launcher (`start.ps1`) starts `app/lib/bin.js web --no-open` so neither `dsh web` nor `future-cup-platform` opens duplicate browser tabs while `start.ps1` waits for HTTP 200 on the platform URL, keeps runtime SQLite state, generated workspaces, and `.env` under a local `data/` directory excluded from distribution archives, and prompts for `DEEPSEEK_API_KEY` via a Windows Forms dialog when missing.

## Consequences

- Relocatable archives extracted to arbitrary drives or separate Windows machines resolve all workspace and vendor ESM imports without referencing the original source checkout.
- Packaging checks must include an explicit zero-reparse-point verification and exclude `data/` from distributable `.zip` archives so local test API keys are never leaked.
- Any future workspace or vendor dependency added to `apps/cli` or `future-cup-platform` is automatically covered when the packaging step syncs missing packages and dereferences all junctions.

## Alternatives considered

- **Bundle with `pnpm deploy` virtual store without hoisted linking.** Rejected because Cordis dynamic plugin loading and ESM resolution across hoisted workspace peers failed with missing package errors unless transitive peers were materialized flat under `app/node_modules`.
- **Keep `--config.link-workspace-packages=true` junctions and rely on archive tool flags.** Rejected because different Windows archive tools (such as `tar.exe`, Explorer ZIP, and 7-Zip) handle NTFS junctions inconsistently; materializing real files in the staging directory guarantees portability regardless of how the user compresses or extracts it.
- **Package as a Node.js Single Executable Application (SEA).** Rejected because Cordis plugin discovery scans package directories under `node_modules`, `future-cup-platform` serves static `lib/web/**` assets, and the runtime loads native `.node` addons (`native/system`, `koffi`, `node-pty`).
