# Future Cup Multi-Agent Orchestration Workbench

English | [中文](README.zh.md)

This repository contains the **Future Cup multi-agent orchestration workbench** and its initial-round deliverables. It is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), an everything-is-a-plugin agent harness powered by [Cordis](https://github.com/cordiverse/cordis). Harness supplies agents, sessions, tools and model adapters; Future Cup adds the control plane and an MCP Server for external clients.

The workbench turns a natural-language requirement into a durable task DAG, assembles and freezes a versioned agent team, schedules concurrent work, runs independent browser verification, applies bounded self-repair, and produces a runnable project with execution evidence. **The frontend engineering crew is one built-in team, not the product itself** — the platform is a general multi-agent orchestration workbench.

> The upstream documentation and the full plugin corpus are kept in this repository; Future Cup lives in `packages/experimental/`.

## What this is

| Item | Detail |
|---|---|
| Base | DeepSeek Harness (`dsh`) + Cordis, everything-is-a-plugin |
| Platform package | `packages/experimental/future-cup-platform` — REST / Socket.IO server, official MCP Server transport, React management SPA, read-only HQ 3D screen |
| Orchestration package | `packages/experimental/future-cup-orchestration` — durable DAG, explainable scheduling, verification and bounded repair |
| Management UI | `/` — light neumorphic theme, project metrics, six-stage progress, crew panels, MCP connection guide |
| HQ screen | `/hq/index.html?projectId=<id>` — read-only live projection |
| MCP Server | `/api/v1/mcp` — official stateless Streamable HTTP endpoint; `/api/v1/mcp/info` provides browser discovery |
| Default port | `3090`, loopback only |
| Storage | SQLite for local runs, PostgreSQL after configuration |
| License | MIT; HQ 3D assets use PolyForm Noncommercial 1.0.0 |

Key capabilities:

- Persistent task DAG with revision-checked writes, a workflow control graph and recoverable leases.
- Versioned Agent Registry, immutable team versions and per-project team freezing.
- Explainable scheduling, independent build/browser verification and up to three bounded repair rounds.
- Transactional project events with Outbox replay over Socket.IO, REST snapshots and delivery previews.
- A real Harness team launcher, one frozen team per project, and evidence-first delivery.
- An official MCP SDK server exposing eight delegation tools, four read-only resources and two workflow prompts to loopback clients.

<a id="run"></a>

## Quick start

Requirements: Node.js >= 24.9, pnpm 11, and PowerShell 5.1 on Windows for the `.bat` launchers. A `DEEPSEEK_API_KEY` is read from local configuration at launch; **no key is stored in this repository** (see "Secrets and CI" below).

**Option A — Windows launcher (recommended).** Double-click `启动平台.bat` (identical to `start.bat`). `start.ps1` then runs five preflight steps:

| Step | Check |
|---|---|
| 1 | Load `DEEPSEEK_API_KEY` from the local key file or `.env` |
| 2 | Verify `lib/web` artifacts (`index.html`, `hq/index.html`, `hq/hq-bridge.js`) |
| 3 | Make sure port `3090` is free |
| 4 | Verify Node.js >= 24.9 |
| 5 | Start the platform (equivalent to `pnpm start:platform`) |

Open <http://127.0.0.1:3090>. Validation failures exit with code 1 (key), 2 (artifacts) or 3 (port/runtime).

<a id="run-from-source"></a>

**Option B — command line.**

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui
pnpm start:platform
```

`start.ps1` intentionally does **not** build the UI: it only prints a yellow hint when the sources are newer than the artifacts.

Keys: the launcher first tries the local key file configured in `start.ps1`, then the repository-root `.env`; you can also export `DEEPSEEK_API_KEY` in the current shell. `.env` is gitignored — never commit a key value.

## Build the UI

```sh
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui
```

`build:ui` runs two Vite builds in sequence: the management SPA into `lib/web/`, then the HQ screen into `lib/web/hq/` (producing `hq-bridge.js`). `lib/web/` is gitignored build output, not source. After any change under `ui/src`, rebuild and refresh the page (Ctrl+F5 if the hashed bundle is cached). Check that `lib/web/hq/hq-bridge.js` exists before starting the platform.

> Do not pipe the build through `head`: closing the pipe early sends SIGPIPE to the second Vite process and silently drops `hq-bridge.js`. Redirect to a log file instead.

## MCP Server

The platform exposes its project workflow through an official MCP SDK server at `/api/v1/mcp`. It supports protocol negotiation, JSON-RPC notifications, structured tool errors, loopback Host/Origin validation and graceful shutdown. Eight tools cover team recommendation, project creation, run control, status, verification and project derivation; four resources expose projects, published teams, project memory and latest verification evidence; two prompts guide new-project delegation and verified-project upgrades.

Browser discovery is separate at `/api/v1/mcp/info`, and the management header provides an MCP access guide with the endpoint and client configuration. The MCP direction is outbound: external clients call Future Cup, while calling external MCP servers from the platform's own Agent loop is outside the current product scope.

## Common commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install workspace dependencies (Node >= 24.9) |
| `pnpm start:platform` | Start the workbench on port 3090 |
| `pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui` | Build management SPA + HQ screen |
| `pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform typecheck:ui` | Type-check the UI |
| `pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform test:ui` | Run UI unit tests (Vitest) |
| `pnpm run typecheck` | Repository-wide type check (pre-push hook, 6 gates) |
| `pnpm run doc-sync` | Documentation consistency gates |
| `pnpm run build` | Build artifacts and run build checks |
| `make platform` / `make build` | Makefile shortcuts |

## Repository layout

| Path | Contents |
|---|---|
| `start.ps1`, `start.bat`, `启动平台.bat` | Windows launchers and preflight checks |
| `apps/cli/` | `dsh` CLI and the Web entry point |
| `packages/experimental/future-cup-platform/` | Platform server, management UI (`ui/`), HQ screen, Prisma schema |
| `packages/experimental/future-cup-orchestration/` | DAG, scheduling, verification and repair logic |
| `packages/*/*`, `vendor/` | Harness plugin packages and vendored Cordis |
| `docs/`, `.agents/notes/` | Architecture, development guides and design notes |
| `scripts/`, `.github/workflows/` | Gates, generators and CI workflows |
| `deliverables/future-cup-initial/` | Initial-round deliverables (see below) |
| `python/`, `native/`, `benchmarks/` | Python SDK, native addon sources and performance gates |

## Initial-round deliverables

`deliverables/future-cup-initial/` contains the proposal, system report, evidence matrix, architecture diagrams, functional and test screenshots, and raw test data. The baseline is the 2026-11-03 initial-round version; start with the [package README](deliverables/future-cup-initial/README.md) and `文案/初赛方案书.docx`.

`文件清单.json` records the byte size and sha256 of all 55 shipped files. If you edit any file in the package, recompute the matching entry — otherwise the manifest no longer verifies.

## Verification

A focused local loop before committing UI work:

```sh
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform typecheck:ui
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform test:ui
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui
```

The UI suite currently covers 25 test files / 98 cases. Lefthook runs lint on staged files, `git diff --cached --check` and the vendor manifest guard at commit time, and the full `pnpm run typecheck` (6 gates) before pushing.

Both READMEs are a bilingual pair. After editing either side, bring the other along and re-record the section hashes:

```sh
pnpm run verify-translation-pairing --write README.md
```

## Secrets and CI

This repository keeps **no secrets**: no committed `.env`, no hard-coded API keys and no GitHub Actions secret. `.env` is gitignored and used only for local runs; key values must never be committed. The launchers read a key from the local machine at runtime instead.

`.github/workflows/e2e.yml` runs real-API end-to-end tests and hard-fails its `Preflight (require DEEPSEEK_API_KEY)` step when `DEEPSEEK_API_KEY_EXTERNAL` is empty — deliberately, because a keyless suite would self-skip and report a false green. Since this repository intentionally configures no secret, that workflow shows failed runs on pushes and its nightly schedule. This is expected and is not a code failure; local verification relies on `typecheck:ui`, `test:ui` and `pnpm run typecheck`.

## Documentation

- [AGENTS.md](AGENTS.md) — repository rules for agents and contributors
- [Architecture](docs/architecture.md) and [development guide](docs/development.md)
- [Platform package README](packages/experimental/future-cup-platform/README.md) — REST API and implementation notes
- [Safety notice](SAFETY.md) and [contributing guide](CONTRIBUTING.md)
- [Initial-round deliverables README](deliverables/future-cup-initial/README.md)
- Competition constraints and milestones live in `.agents/notes/proposed/feature/2026-10-30-future-cup-web-frontend-agent-platform.zh.md`

## License

[MIT](LICENSE). Third-party dependencies are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The HQ 3D scene is distributed under PolyForm Noncommercial License 1.0.0; keep its license and Required Notice in every distribution, and obtain a separate authorization for commercial use.
