# Repository Atlas: DeepSeek Harness & Future Cup Platform

## Project Responsibility
DeepSeek Harness is an all-plugin Cordis-based agent harness engineered for autonomous software engineering, robust task planning, and scalable sub-agent delegation. It hosts the **Future Cup Multi-Agent Frontend Engineering Platform**, an end-to-end autonomous development platform capable of taking high-level user requirements, recommending and assembling specialized Agent teams, scheduling topological task DAGs, executing concurrent coding tasks with DeepSeek models, verifying deliverables in sandboxed browsers, and automatically self-healing failures.

## System Entry Points
- **`启动平台.bat` / `start.bat`**: Windows 一键启动脚本，自动读取 `E:\密钥\apikeydeepseek.txt` 或 `.env` 中的 DeepSeek API Key，拉起平台并在浏览器中自动打开 `http://127.0.0.1:3090/`。
- **`apps/cli/src/bin.ts`**: 主命令行入口，解析 CLI 参数、装配 Cordis 插件容器并启动 Web 或 Headless 运行模式。
- **`packages/experimental/future-cup-platform/src/server.ts`**: 平台后端服务入口，提供 Fastify RESTful 接口、Socket.IO 实时通信网关及预构建静态资源托管。
- **`packages/experimental/future-cup-platform/ui/src/main.tsx`**: 前端单页应用 (SPA) 入口，挂载 Ant Design 6 主题、React Router 路由及 XyFlow DAG 可视化画布。
- **`packages/experimental/future-cup-orchestration/src/index.ts`**: 多 Agent 编排引擎核心，包含 DAG 依赖调度器、Agent 团队装配器、自愈修复循环与自动化验证器。
- **`package.json`**: 根工作空间依赖清单与构建/运行脚本（`pnpm start`、`pnpm run build`、`pnpm run test` 等）。

---

## Directory Map (Aggregated)

| Directory | Responsibility Summary | Detailed Map |
| :--- | :--- | :--- |
| **`apps/`** | Application entry points and runtime deployment executables. | [View Map](apps/codemap.md) |
| **`apps/cli/`** | Main CLI package wrapping tsx/esm hooks and Cordis profiles. | [View Map](apps/cli/codemap.md) |
| **`apps/cli/src/`** | Source implementation of CLI command parser and profile loader. | [View Map](apps/cli/src/codemap.md) |
| **`packages/`** | Monorepo workspaces for core runtime, protocols, providers, and plugins. | [View Map](packages/codemap.md) |
| **`packages/core/`** | Foundational agent execution loop, session state machine, and persistence protocols. | [View Map](packages/core/codemap.md) |
| **`packages/core/agent/`** | Agent abstraction, tool invocation dispatcher, and iterative reasoning loop. | [View Map](packages/core/agent/codemap.md) |
| **`packages/core/agent/src/`** | Source files for Agent service, context management, and guardrails. | [View Map](packages/core/agent/src/codemap.md) |
| **`packages/core/session/`** | Durable session storage, append-only event stream, and replay projections. | [View Map](packages/core/session/codemap.md) |
| **`packages/core/session/src/`** | Event Sourcing implementations, SQLite journal, and session recovery. | [View Map](packages/core/session/src/codemap.md) |
| **`packages/llm/`** | Large language model provider abstraction and token tracking interfaces. | [View Map](packages/llm/codemap.md) |
| **`packages/llm/llm-pi-ai/`** | DeepSeek and Pi-AI streaming client with retry, backoff, and key loading. | [View Map](packages/llm/llm-pi-ai/codemap.md) |
| **`packages/llm/llm-pi-ai/src/`** | Implementation of ModelProvider plugin and Server-Sent Events (SSE) parser. | [View Map](packages/llm/llm-pi-ai/src/codemap.md) |
| **`packages/experimental/`** | Specialized incubation workspaces and competition platforms. | [View Map](packages/experimental/codemap.md) |
| **`packages/experimental/future-cup-orchestration/`** | Future Cup multi-agent orchestration engine, DAG scheduler, and repair. | [View Map](packages/experimental/future-cup-orchestration/codemap.md) |
| **`packages/experimental/future-cup-orchestration/src/`** | Core engine files: DagEngine, AgentRegistry, TeamRecommender, AdaptiveRepair. | [View Map](packages/experimental/future-cup-orchestration/src/codemap.md) |
| **`packages/experimental/future-cup-platform/`** | Full-stack Web & API platform plugin hosting port 3090. | [View Map](packages/experimental/future-cup-platform/codemap.md) |
| **`packages/experimental/future-cup-platform/src/`** | Fastify REST controllers, WebSocket pub-sub gateway, and static assets. | [View Map](packages/experimental/future-cup-platform/src/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/`** | Single Page Application (SPA) frontend build workspace (React 18 + Vite). | [View Map](packages/experimental/future-cup-platform/ui/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/`** | Frontend source root: App layout, Ant Design styling, and global routing. | [View Map](packages/experimental/future-cup-platform/ui/src/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/api/`** | Typed API contracts, REST client, and Socket.IO real-time connection. | [View Map](packages/experimental/future-cup-platform/ui/src/api/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/components/`** | Reusable UI components: Agent cards, status pills, metrics, and progress bars. | [View Map](packages/experimental/future-cup-platform/ui/src/components/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/diff/`** | Code diff viewer and file modification visual inspection tools. | [View Map](packages/experimental/future-cup-platform/ui/src/diff/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/graph/`** | XyFlow DAG canvas, animated edge paths, and topological auto-layout. | [View Map](packages/experimental/future-cup-platform/ui/src/graph/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/hooks/`** | Custom React hooks for project querying and live event stream subscriptions. | [View Map](packages/experimental/future-cup-platform/ui/src/hooks/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/hq/`** | Vector graphics, brand SVG icons, and high-DPI display assets. | [View Map](packages/experimental/future-cup-platform/ui/src/hq/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/locale/`** | Type-safe internationalization (i18n) dictionaries (zh-CN / en-US). | [View Map](packages/experimental/future-cup-platform/ui/src/locale/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/pages/`** | View containers: Overview, DAG, Strategy, Verification, Repair, Teams. | [View Map](packages/experimental/future-cup-platform/ui/src/pages/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/realtime/`** | WebSocket event listener normalizing socket messages into React state. | [View Map](packages/experimental/future-cup-platform/ui/src/realtime/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/routes/`** | Application routing hierarchy and view transition navigation map. | [View Map](packages/experimental/future-cup-platform/ui/src/routes/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/state/`** | Global state stores for active project runs, selection, and theme mode. | [View Map](packages/experimental/future-cup-platform/ui/src/state/codemap.md) |
| **`packages/experimental/future-cup-platform/ui/src/team/`** | Multi-agent team builder, role editor, and concurrency allocation UI. | [View Map](packages/experimental/future-cup-platform/ui/src/team/codemap.md) |
