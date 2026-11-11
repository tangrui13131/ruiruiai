# Future Cup 多 Agent 调度工作站

[English](README.md) | 中文

本仓库是 **Future Cup 多 Agent 调度工作站** 的实现与初赛交付材料。底座为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）——由 [Cordis](https://github.com/cordiverse/cordis) 驱动的「一切皆插件」agent harness。Harness 提供 Agent、Session、工具与模型适配能力，Future Cup 在其之上实现平台控制层与面向外部客户端的 MCP Server。

工作站把自然语言需求转为持久任务 DAG，装配并冻结版本化 Agent 团队，并发调度任务，执行独立浏览器验证，进行有界自愈修复，最终交付可运行的工程与执行证据。**前端工程团队只是内置的一个团队，不是平台本身**——平台定位是通用的多 Agent 调度工作站。

> 本仓库保留了上游文档与完整插件体系；Future Cup 相关实现位于 `packages/experimental/`。

## 这是什么

| 项目 | 内容 |
|---|---|
| 底座 | DeepSeek Harness（`dsh`）+ Cordis，一切皆插件 |
| 平台包 | `packages/experimental/future-cup-platform`：REST / Socket.IO 服务、官方 MCP Server 传输、React 管理应用、只读 HQ 3D 大屏 |
| 编排包 | `packages/experimental/future-cup-orchestration`：持久 DAG、可解释调度、独立验证与有界修复 |
| 管理界面 | `/`：浅色拟态主题、项目指标、六阶段进度、团队面板、MCP 接入指引 |
| HQ 大屏 | `/hq/index.html?projectId=<id>`：只读实时投影 |
| MCP Server | `/api/v1/mcp`：官方无状态 Streamable HTTP 端点；`/api/v1/mcp/info` 提供浏览器发现数据 |
| 默认端口 | `3090`，仅绑定 loopback |
| 存储 | 本地运行用 SQLite，配置后可用 PostgreSQL |
| 许可 | MIT；HQ 3D 资产采用 PolyForm Noncommercial 1.0.0 |

核心能力：

- 带 revision 校验的持久任务 DAG、工作流控制图与可恢复租约。
- 版本化 Agent Registry、不可变团队版本与项目级团队冻结。
- 可解释调度、独立构建/浏览器验证与最多三轮有界修复。
- 事务性项目事件与 Outbox 重放（Socket.IO）、REST 快照与交付预览。
- 真实 Harness 团队启动器、项目冻结团队，以及「以执行证据为准」的交付。
- 官方 MCP SDK 服务端向 loopback 客户端提供八个委托工具、四个只读资源和两个工作流提示词。

<a id="run"></a>

## 快速开始

环境要求：Node.js >= 24.9、pnpm 11；Windows 下使用 `.bat` 启动器需要 PowerShell 5.1。启动时从本机配置读取 `DEEPSEEK_API_KEY`；**仓库不保存任何密钥**（见下文「密钥与 CI」）。

**方式 A — Windows 启动器（推荐）**：双击 `启动平台.bat`（与 `start.bat` 内容相同）。`start.ps1` 依次执行 5 步前置校验：

| 步骤 | 校验内容 |
|---|---|
| 1 | 从本机密钥文件或 `.env` 载入 `DEEPSEEK_API_KEY` |
| 2 | 校验 `lib/web` 产物（`index.html`、`hq/index.html`、`hq/hq-bridge.js`） |
| 3 | 确认端口 `3090` 未被占用 |
| 4 | 校验 Node.js >= 24.9 |
| 5 | 启动平台（等价于 `pnpm start:platform`） |

浏览器打开 <http://127.0.0.1:3090>。校验失败时退出码为 1（密钥）、2（产物）或 3（端口/运行时）。

<a id="run-from-source"></a>

**方式 B — 命令行**：

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui
pnpm start:platform
```

`start.ps1` **不会自动构建前端**：源码比产物新时只打印黄色提示。

密钥：启动器优先读取 `start.ps1` 中配置的本机密钥文件，其次读取仓库根目录 `.env`；也可以在当前终端预设 `DEEPSEEK_API_KEY` 环境变量。`.env` 已被 gitignore，**切勿提交密钥值**。

## 前端产物构建

```sh
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui
```

`build:ui` 串跑两个 Vite：管理 SPA 输出到 `lib/web/`，HQ 大屏输出到 `lib/web/hq/`（生成 `hq-bridge.js`）。`lib/web/` 是被 gitignore 的构建产物，不是源码。改动 `ui/src` 后必须重新构建并刷新页面（产物带内容 hash，必要时 Ctrl+F5）。启动平台前请确认 `lib/web/hq/hq-bridge.js` 存在。

> 不要用 `| head` 截断构建输出：管道提前关闭会让第二个 Vite 收到 SIGPIPE，静默丢掉 `hq-bridge.js`。请重定向到日志文件再查看。

## MCP Server

平台通过官方 MCP SDK 在 `/api/v1/mcp` 暴露项目工作流，支持协议协商、JSON-RPC 通知、结构化工具错误、loopback Host/Origin 校验与优雅关闭。八个工具覆盖团队推荐、项目创建、运行控制、状态查询、验证证据与项目派生；四个资源提供项目目录、已发布团队、项目记忆与最新验证证据；两个提示词分别指导新项目委托和已验证项目升级。

浏览器发现数据单独位于 `/api/v1/mcp/info`，管理界面顶部提供 MCP 接入指引、端点地址和客户端配置。MCP 方向为对外提供：外部客户端调用 Future Cup；从平台内部 Agent 循环调用其他外部 MCP Server 不属于当前产品范围。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装工作区依赖（Node >= 24.9） |
| `pnpm start:platform` | 在 3090 端口启动工作站 |
| `pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui` | 构建管理 SPA 与 HQ 大屏 |
| `pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform typecheck:ui` | UI 类型检查 |
| `pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform test:ui` | UI 单元测试（Vitest） |
| `pnpm run typecheck` | 全仓类型检查（pre-push 钩子，6 个 gate） |
| `pnpm run doc-sync` | 文档一致性门禁 |
| `pnpm run build` | 构建产物并执行构建检查 |
| `make platform` / `make build` | Makefile 快捷入口 |

## 目录结构

| 路径 | 内容 |
|---|---|
| `start.ps1`、`start.bat`、`启动平台.bat` | Windows 启动器与前置校验 |
| `apps/cli/` | `dsh` CLI 与 Web 入口 |
| `packages/experimental/future-cup-platform/` | 平台服务、管理界面（`ui/`）、HQ 大屏、Prisma schema |
| `packages/experimental/future-cup-orchestration/` | DAG、调度、验证与修复逻辑 |
| `packages/*/*`、`vendor/` | Harness 插件包与内置的 Cordis |
| `docs/`、`.agents/notes/` | 架构、开发指南与设计笔记 |
| `scripts/`、`.github/workflows/` | 门禁、生成脚本与 CI 工作流 |
| `deliverables/future-cup-initial/` | 初赛交付包（见下文） |
| `python/`、`native/`、`benchmarks/` | Python SDK、原生插件源码与性能门禁 |

## 初赛交付包

`deliverables/future-cup-initial/` 收录方案书、系统报告、赛题证据矩阵、架构图、功能与测试截图及原始测试数据。基线为 2026-11-03 的初赛交付版本；建议先阅读 [交付包说明](deliverables/future-cup-initial/README.md) 与 `文案/初赛方案书.docx`。

`文件清单.json` 记录了 55 个文件的字节数与 sha256。改动交付包内任何文件后，必须同步重算对应条目，否则清单不再自洽。

## 验证

提交 UI 改动前的本地组合：

```sh
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform typecheck:ui
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform test:ui
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform build:ui
```

UI 测试当前覆盖 25 个测试文件 / 98 个用例。lefthook 在提交时运行暂存文件 lint、`git diff --cached --check` 与 vendor manifest 校验，在推送前运行全仓 `pnpm run typecheck`（6 个 gate）。

两份 README 是双语配对文档。改动任意一侧后要同步另一侧，并重新记录段落哈希：

```sh
pnpm run verify-translation-pairing --write README.md
```

## 密钥与 CI

本仓库**不保存任何密钥**：没有 `.env` 入库、没有硬编码 API key，也没有配置 GitHub Actions Secret。`.env` 已被 gitignore，仅用于本地运行；密钥值绝不提交，启动器在运行时从本机读取。

`.github/workflows/e2e.yml` 运行真实 API 的端到端测试，并在 `DEEPSEEK_API_KEY_EXTERNAL` 为空时让 `Preflight (require DEEPSEEK_API_KEY)` 主动失败——这是刻意的：无密钥时测试集会自跳过，若直接报绿就成了「假绿」。由于本仓库按要求不配置该 Secret，这个工作流在 push 与每日定时运行中会显示失败，属于预期状态，不代表代码有问题；本地验证以 `typecheck:ui`、`test:ui` 与 `pnpm run typecheck` 为准。

## 文档

- [AGENTS.md](AGENTS.md)：面向 agent 与贡献者的仓库规则
- [架构文档](docs/architecture.zh.md) 与 [开发指南](docs/development.zh.md)
- [平台包 README](packages/experimental/future-cup-platform/README.zh.md)：REST API 与实现说明
- [安全说明](SAFETY.zh.md) 与 [贡献指南](CONTRIBUTING.zh.md)
- [初赛交付包说明](deliverables/future-cup-initial/README.md)
- 赛题约束与里程碑记录在 `.agents/notes/proposed/feature/2026-10-30-future-cup-web-frontend-agent-platform.zh.md`

## 许可

[MIT](LICENSE)。第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。HQ 3D 场景采用 PolyForm Noncommercial License 1.0.0，每次分发都需保留许可证与 Required Notice；商业用途需另行取得授权。
