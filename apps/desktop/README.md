# Future Cup desktop shell

English | [中文](README.zh.md)

Minimal Electron shell that runs the Future Cup platform as a Windows desktop application. The shell owns the window, the frameless caption overlay, the API-key dialog, and the lifecycle of the bundled dsh host; the platform itself remains unchanged.

## Layout

```
apps/desktop/
  src/main.ts        single instance, window, quit lifecycle
  src/host.ts        spawns `dsh web` under Electron Node mode
  src/preload.cts    frameless drag regions and caption theme bridge
  src/settings.ts    API-key encryption through the OS credential store
  renderer/          splash and first-run settings documents
  scripts/           runtime-closure preparation
```

## Development

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-desktop-shell run prepare:runtime
pnpm --filter @deepseek-ai/dsh-desktop-shell run prepare:portable
pnpm --filter @deepseek-ai/dsh-desktop-shell run dev
```

`prepare:runtime` deploys `dsh-desktop-runtime-closure`, materializes workspace links, and prunes source maps and declarations into `apps/desktop/runtime/app`. Set `DSH_DESKTOP_CLOSURE` to use a different closure during development.

`prepare:portable` adds a portable Node.js 24 distribution at `apps/desktop/runtime/node` and Playwright Chromium 1255 at `apps/desktop/runtime/playwright-browsers`. The host prepends the bundled Node directory to `PATH` and sets `PLAYWRIGHT_BROWSERS_PATH`, so a clean Windows machine can run `npm install`, the Vite build, and browser verification without global installs.

`DEEPSEEK_API_KEY` in the environment bypasses the first-run dialog. `DSH_DESKTOP_CAPTURE=<path>` writes a PNG of the loaded window and exits, which is useful for visual checks.

## Packaging

```sh
pnpm --filter @deepseek-ai/dsh-desktop-shell run package:win
```

The NSIS installer lands in `apps/desktop/release-final/`. The runtime closure is shipped under `resources/runtime/app`, outside the ASAR archive, so native modules keep their normal filesystem layout.

## Portable drive

Place an empty `portable.flag` next to `Future Cup.exe`; the app then stores `settings.json`, the SQLite database, runs, and the dsh home under `userdata/` beside the executable. The whole profile travels with the drive.

Keep the drive letter stable. Recorded run paths are absolute, so moving the profile to another letter or directory leaves history screenshots and previews unresolvable.

Portable mode stores the API key as plaintext in `userdata/settings.json` because Windows DPAPI cannot decrypt across machines. Protect the drive and remove that file before lending it.

## Import web history

A database copied from a web deployment records absolute screenshot, preview, and workspace paths under the web run root. The artifact server only serves files inside its own run root, so those history entries render empty image slots. With the application closed, copy the artifacts into the desktop data root and rewrite the recorded paths:

```sh
node apps/desktop/scripts/import-history.mjs --dry-run
node apps/desktop/scripts/import-history.mjs
```

The script backs the database up first, copies screenshots and workspaces (without `node_modules` or `.git`), and rewrites `project_runs.workspace_path`, `project_runs.preview_path`, and the screenshot paths in `verification_reports.report_json`. Portable installs pass their own profile:

```sh
node apps/desktop/scripts/import-history.mjs --target-data-root "G:\瑞睿AI\Future Cup\userdata\data"
```
