# Agent Note: Future Cup web frontend engineering agent platform

Status: proposed

[English](2026-10-30-future-cup-web-frontend-agent-platform.md) | 中文

## Problem

未来杯竞赛要求交付一个可运行的多 Agent 编排平台，并真实展示知识集成、Agent 团队定义、工作流编排、动态调度、self-loop 与结果验证。单个编程 Agent、模型 API 壳子、纯 PPT 概念，或者未经实质改造的框架示例，都不能满足提交要求。

此前的项目记录把微前端与运营 H5 编排平台及 React Flow 编辑器选为首选产品。方案 V1.0 改变了这项产品决策：平台必须接收前端工程开发需求，协调专业 Agent，生成可运行的前端工程，在浏览器中验证，修复失败，并交付项目。继续把此前场景作为当前项目记忆，会让后续架构和验收工作遵循错误的产品边界。

M1 与 M2 已经完成，M3 是下一个受门禁约束的里程碑。项目需要一份记录竞赛约束、产品边界、系统架构、Agent 职责、五个交付里程碑，以及已经验证的 M1/M2 决策的项目记忆。[此前的编排提案](../../rejected/feature/2026-10-29-future-cup-multi-agent-orchestration-platform.zh.md)保留为被否决的决策依据。

## Proposal

构建一个面向 Web 前端工程开发的多 Agent 编排与自愈平台，优先复用 DeepSeek Harness，并将自研创新集中于动态调度、真实执行验证和有界自主修复。MVP 接收自然语言前端需求，生成任务 DAG，分配专业 Agent，写入真实 React 工程，验证结果，并交付带证据的可运行项目。

### Product boundary

- 产品不是通用网页生成器、通用 Agent 市场、通用工作流平台或完整全栈应用生成器。
- MVP 只支持生成 React、TypeScript、Vite 与 Ant Design 项目。Vue、Next.js 和额外技术栈不进入 MVP。
- 平台管理应用与被生成的前端项目是两个独立产品，使用不同工作区。
- HQ 3D 大屏展示真实执行事件。它不作为任务状态的真源，也不能把模拟活动当作正式执行数据。
- MVP 不生成业务流程后端；交付物是可运行的前端工程。

### System architecture

- 管理界面使用 React、TypeScript、Vite、Ant Design，并使用 React Flow 展示工作流与 DAG。
- 平台后端使用 Node.js、Fastify、Zod、PostgreSQL、Prisma 与 Socket.IO。这些选择仍是待验证的技术基线，不代表所有集成已经可用。
- 后端通过官方 TypeScript SDK 控制 DeepSeek Harness，在重复实现前使用原生 Session、Agent 执行、工具、事件与取消能力。
- 工作流先验证 Harness 原生能力。只有在出现明确的持久化、恢复或条件分支缺口时，才评估自研轻量 DAG。LangGraph.js 属于后续比较项，不是初始依赖；同一时间只能有一个工作流负责人。
- 被生成的项目代码属于不可信输入。执行需要独立工作区、文件访问限制、命令控制、CPU 与内存限制、网络限制、超时、并发限制、生命周期清理与资源回收。
- 使用 Docker 或 SWE-ReX 评估进程隔离。Harness 文件权限不被视为完整的容器边界，Node.js `vm` 永远不能作为安全沙箱。
- 所有产品可见的执行状态都来自持久化任务、Session、验证与修复记录。凭据只能来自环境变量或安全的部署配置。

### Platform data

MVP 的逻辑数据模型包含以下记录；索引、外键、唯一约束、审计字段与删除行为在实现阶段定义。

| 记录 | 用途 |
|---|---|
| `users` | 平台用户身份与归属 |
| `agents` | Agent 角色、模型、提示词、工具与状态 |
| `projects` | 需求、技术栈、工作区与交付状态 |
| `tasks` | DAG 节点状态、优先级、分配与重试次数 |
| `task_dependencies` | 有向任务前置关系 |
| `executions` | Agent 执行、Session 引用、时间与失败信息 |
| `execution_events` | 有序的产品与运行时事件 |
| `verification_reports` | 结构化的静态检查、构建与浏览器证据 |
| `repair_records` | 修复轮次、错误、变更摘要、差异与结果 |

### Agent team

MVP 使用固定团队。每个 Agent 使用独立 Session，具有明确输入输出、受限工具权限和持久化执行记录。

| Agent | 职责 |
|---|---|
| Planner | 分析需求，产出页面、约束、Agent 能力需求与任务 DAG |
| UI Designer | 产出共享的布局、视觉、组件与响应式设计规范 |
| Frontend Agent | 为边界明确的任务实现页面、组件、路由、交互与样式 |
| Integration Agent | 集成页面与路由，解决冲突，检查共享接口 |
| Tester | 从需求推导预期行为，编写组件测试与 Playwright 测试 |
| Verifier | 基于真实证据独立执行静态检查、构建、浏览器与控制台检查 |
| Repair Agent | 诊断结构化失败，修改代码，并把结果送回验证 |

### Task DAG and scheduling

任务使用 `PENDING`、`READY`、`RUNNING`、`COMPLETED`、`FAILED`、`BLOCKED` 与 `CANCELLED` 状态。无依赖任务可以并行执行；依赖任务等待前置结果被接受；失败前置任务不能推进下游工作。

调度器根据任务要求匹配 Agent 能力，遵守依赖就绪与可用状态，考虑负载和历史成功率，并记录候选 Agent、最终选择与选择原因。MVP 权重必须明确、可配置、通过可重复评估确定，不能用不透明的学习模型替代。

每次分配、重新排队、取消、失败和 DAG 变更都写入持久化事件或任务修订，使客户端刷新后仍能重建执行过程。

### Verification and self-loop

验证结合项目结构检查、TypeScript 与 ESLint、依赖与构建结果、服务器启动、Playwright 浏览器测试、页面可见性、关键交互、失败请求和浏览器控制台错误。报告使用 `PASS`、`FAIL`、`WARNING` 或 `INCOMPLETE`；Agent 的自然语言回复不能在没有执行证据时宣布任务成功。

Verifier 独立于产生该修订的 Agent。确定性检查与 Agent 判定冲突时，以确定性证据为准。

Self-loop 从结构化报告开始，经过诊断、Repair Agent 修改与完整复验。默认最多允许三轮自动修复，保留每轮报告与代码差异，记录修复前后结果，并在重复等价失败时停止。修复耗尽、超时或没有进展时必须进入可见的人工介入状态，不能无限重试。

### HQ and real events

竞赛复用现有 HQ 战术大屏主题，不再开发另一套 3D 展示。Socket.IO 发布任务创建与规划、调度、Agent 启动与完成、工具调用、验证、修复和任务完成等真实事件。

HQ 将这些事件映射到 Agent、部门、工作流、进度、日志、验证与修复状态。每个事件保留时间戳、任务 ID 与 Agent ID，刷新后从后端重建当前状态。

现有 HQ 源码包含 PolyForm Noncommercial 1.0.0 信息。正式整合或分发前，必须核对其准确许可证、署名、比赛提交、公开分发与商业使用义务。它不能默认被视为 MIT 许可代码。

### Delivery order

项目使用五个验收门禁里程碑，而不是按文档章节顺序开发。

| 里程碑 | 交付结果 |
|---|---|
| M1 | 验证 Harness SDK 与工作流、执行隔离，以及基于 Playwright 的 React 验证 |
| M2 | 证明多个专业 Agent 能通过任务、DAG 执行与调度协作 |
| M3 | 完成代码生成、浏览器验证、有界修复与复验闭环 |
| M4 | 整合管理界面、PostgreSQL、实时事件与 HQ |
| M5 | 完成异常测试、部署、性能工作与比赛材料 |

每个里程碑交付设计、实现、测试、验收报告和遗留问题。可观察验收标准通过前，不进入下一里程碑。

### M1 and M2 results and next work

M1 已于 2026-10-30 完成。官方 TypeScript SDK 启动了真实 Harness runtime，真实 DeepSeek 模型完成了轮次，真实模型生成了 React、TypeScript、Vite 与 Ant Design 工程。后续真实模型轮次安装依赖并运行生产构建；独立 Playwright 验证在桌面与移动视口通过，计数器交互正常。

- Harness 原生 Workflow 可用，但缺少持久 DAG 状态、journaling、resume 与调度；M2 使用 Harness 执行原语与自研轻量 DAG。
- Windows ACL 通过了写入限制测试，但仍是同内核的部分隔离，不能作为不可信或多租户代码的最终边界。
- Docker 29.7.2 与 SWE-ReX 1.4.0 在验证主机上通过了容器 Runtime、持久 shell、文件访问、内存、CPU、PID、网络与清理检查。
- SWE-ReX 1.4.0 需要显式安装 `aiohttp`，其管理 bridge 必须与严格执行网络策略结合。
- M2 实现了实验性 Future Cup 编排包：SQLite 任务修订与 Journal、环检测、就绪传播、失败阻断、恢复、可解释加权调度、负载均衡、重新分配、执行记录与结构化 Agent 契约。
- 真实 DeepSeek E2E 让 Planner、UI Designer、两个并行 Frontend Agent 与 Integration 在独立 Session 中运行。生成的 React/TypeScript/Vite/Ant Design 工程通过 TypeScript 与 Vite 生产构建。
- M3 从独立浏览器验证、结构化失败报告、有界 Repair Agent 重试、重复失败熔断与可见人工升级开始。

## Alternatives considered

**保留此前的微前端与 H5 编排场景。** 已否决，因为方案 V1.0 已把产品改为前端工程交付。此前场景优化的是不同交付物、工作流与演示，继续把它作为当前记忆会把实现引向错误产品。

**构建通用 AI 网页生成器。** 已否决，因为竞赛评估编排、调度、验证与 self-loop，而不是一次性代码生成。没有可观察多 Agent 控制面的生成器属于薄模型应用。

**优先构建通用 Agent 市场。** 已否决，因为任意 Agent 创建、计费、多租户和广泛集成不能证明所需的前端失败到恢复路径，并会超出 MVP。

**用独立编排器取代 Harness，或从 LangGraph.js 开始。** 已否决，因为 Harness 已提供运行时、Session、subagent 与 Agent Teams 原语。只有证明存在原生缺口后才评估独立工作流引擎，并禁止多个工作流负责人并存。

**在构建产品外壳时使用模拟执行、浏览器结果或 HQ 动画。** 已否决，因为竞赛要求客观技术证据。模拟活动会使核心创新声明失效，并掩盖集成失败。

**支持多种前端技术栈，或在闭环可用前完成完整可视化平台。** 已否决，因为每种技术栈都会增加 Agent、工具与验证复杂度。MVP 先证明一条从需求到已验证交付的完整 React 路径。

**反复修复，直到模型偶然成功。** 已否决，因为等价失败可能无限消耗时间与 token，却不保证进展。循环必须有可见边界、重复失败检测和明确升级状态。

## Acceptance criteria

- M1 产出可复现的 Harness 调用记录、有依据的工作流决策、已演示的隔离方案、生成的 React 文件与 Playwright 输出。
- 用户需求能够生成有效任务 DAG，以及可运行的 React、TypeScript、Vite 与 Ant Design 工程。
- 独立并行任务能够并发执行；依赖任务等待前置结果；失败前置任务阻止下游推进。
- 至少 Planner、两个职责不同的实现或集成 Agent、Tester 或 Verifier，以及 Repair Agent 以不同职责运行，并留下持久化执行证据。
- 调度过程展示合规候选、能力证据、负载与就绪状态、选中的 Agent，以及分配或重新分配原因。
- 验证能够捕获确定性构建或浏览器失败，并生成 Repair Agent 可接受的结构化报告。
- Self-loop 保留最多三次修复尝试及其差异，每次修复后重新验证，并在成功、重复失败、超时或耗尽时终止。
- HQ 从持久化事件重建真实任务、Agent、验证与修复状态，不使用模拟执行或不必要的动画。
- 仓库标明上游代码与修改代码，不包含凭据，记录安装与测试流程，并包含规定的技术方案书、幻灯片、演示视频与可复现 Demo。
- 最终演示从一个明确需求走到可运行、已验证的前端工程，并展示预期失败与经过验证的恢复过程。

## Risks

- 竞赛周期较短。M1 可能发现原生 workflow 或隔离能力需要更多适配，因此 M2 及后续范围必须继续受门禁约束。
- Harness Agent Teams 与相关 Session API 可能仍为实验性。竞赛分支必须固定 revision，并保留适配测试。
- Docker 与 SWE-ReX 在宿主支持和运维成本上存在明显差异。未经过真实隔离执行试验就选择其中一个，会使后续安全声明失效。
- 被生成代码属于不可信输入。与宿主共享进程或清理不完整会暴露宿主，并使平台不适合比赛演示。
- 浏览器测试与预览启动可能受时序影响。演示缺陷，以及控制台、服务器、网络与测试证据的采集，必须具有确定性。
- 编程 Agent 可能生成能够构建但不满足需求的代码。Verifier 需要同时使用确定性检查和基于证据的需求审查。
- 动态调度可能退化为装饰性评分。MVP 必须展示经过测量、可重复的选择行为，而不是无法解释的权重。
- HQ 资产带有许可证义务，在核对条款前不能重新分发或用于商业展示。
- 超出 React MVP 或引入多个工作流引擎会分散实现精力，并产生相互冲突的执行真源。
