# Agent Note: Future Cup web frontend engineering agent platform

Status: proposed

[English](2026-10-30-future-cup-web-frontend-agent-platform.md) | 中文

## Problem

未来杯竞赛要求交付一个可运行的多 Agent 编排平台，并真实展示知识集成、Agent 团队定义、工作流编排、动态调度、self-loop 与结果验证。单个编程 Agent、模型 API 壳子、纯 PPT 概念，或者未经实质改造的框架示例，都不能满足提交要求。

此前的项目记录把微前端与运营 H5 编排平台及 React Flow 编辑器选为首选产品。方案 V1.0 改变了这项产品决策：平台必须接收前端工程开发需求，协调专业 Agent，生成可运行的前端工程，在浏览器中验证，修复失败，并交付项目。继续把此前场景作为当前项目记忆，会让后续架构和验收工作遵循错误的产品边界。

M1、M2、M3、M4.0、M4.1、M4.2、M4.3、M4.4、M5.1、M5.2、M5.3、M5.4 与 M5.5 已经完成，M5.6 是下一个受门禁约束的阶段。项目需要一份记录竞赛约束、产品边界、系统架构、Agent 职责、五个交付里程碑，以及已经验证的 M1/M2/M3/M4/M5.1/M5.2/M5.3/M5.4/M5.5 决策的项目记忆。[此前的编排提案](../../rejected/feature/2026-10-29-future-cup-multi-agent-orchestration-platform.zh.md)保留为被否决的决策依据。

## Proposal

构建一个面向 Web 前端工程开发的多 Agent 编排与自愈平台，优先复用 DeepSeek Harness，并将自研创新集中于动态调度、真实执行验证和有界自主修复。MVP 接收自然语言前端需求，生成任务 DAG，分配专业 Agent，写入真实 React 工程，验证结果，并交付带证据的可运行项目。

### Product boundary

- 产品不是通用网页生成器、通用 Agent 市场、通用工作流平台或完整全栈应用生成器。
- MVP 只支持生成 React、TypeScript、Vite 与 Ant Design 项目。Vue、Next.js 和额外技术栈不进入 MVP。
- 平台管理应用与被生成的前端项目是两个独立产品，使用不同工作区。
- HQ 3D 大屏展示真实执行事件。它不作为任务状态的真源，也不能把模拟活动当作正式执行数据。
- MVP 不生成业务流程后端；交付物是可运行的前端工程。
- Agent 创建的产品单位是一整套团队编制，而不是孤立 Agent。M5 的团队推荐与编辑受控于已批准角色原型、工具权限上限和输出约定，不扩展为通用 Agent 市场或任意工具平台。

### System architecture

- 管理界面使用 React、TypeScript、Vite、Ant Design，并使用 React Flow 展示工作流与 DAG。
- 平台后端使用 Node.js、Fastify、Zod、PostgreSQL、Prisma 与 Socket.IO。M4.1 已实现持久化、API、Outbox、重放与 profile 组合。
- M4.0 已用 PostgreSQL 17.11、Prisma 7.10.1 与真实 Docker 验证 migration、事务 Outbox、项目级事件序号、跨进程租约与 fencing token。
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
| `agents` | 按团队版本实例化的 Agent、Session、模型、工具、负载与状态 |
| `agent_definitions` | Agent 身份、用途、发现标签与生命周期 |
| `agent_definition_versions` | 不可变的提示词、模型、能力、工具策略、记忆策略、输入输出与资源约束 |
| `agent_team_versions` | 不可变的团队编制、校验结果与发布版本 |
| `agent_team_members` | 团队版本引用的 Agent 定义版本、实例数量与调度策略 |
| `project_team_bindings` | 项目启动时冻结的团队版本绑定 |
| `project_memory_entries` | 项目级结构化需求、设计决策、失败模式与已接受交付摘要 |
| `projects` | 需求、技术栈、工作区与交付状态 |
| `tasks` | DAG 节点状态、优先级、分配与重试次数 |
| `task_dependencies` | 有向任务前置关系 |
| `executions` | Agent 执行、Session 引用、时间与失败信息 |
| `execution_events` | 有序的产品与运行时事件 |
| `verification_reports` | 结构化的静态检查、构建与浏览器证据 |
| `repair_records` | 修复轮次、错误、变更摘要、差异与结果 |
| `repair_strategy_decisions` | 失败分类、候选修复策略、选择理由与结果 |
| `workflow_control_events` | 条件分支、循环轮次与子工作流状态转换 |
| `project_events` | 项目级单调序号的产品事件与重连来源 |
| `outbox_events` | 与状态事务同提交的实时投递义务 |
| `workflow_leases` | owner、heartbeat、expiry 与 fencing token |

### Agent team

M2 至 M4 使用经过真实验证的固定团队。每个 Agent 使用独立 Session，具有明确输入输出、受限工具权限和持久化执行记录。

M5 将团队作为用户可配置的一等对象。默认配队入口不要求用户理解 Agent 角色：用户描述目标，系统提取项目画像，必要时最多提出三个关键问题，再从受控角色库和已验证团队模板中推荐完整编制。模型只负责理解需求与建议，最终团队由确定性规则校验和生成。

推荐结果以通俗语言展示职责、并行收益、负载、权限、缺失能力和风险。用户可一键采用、用自然语言调整或保存版本。高级用户可编辑团队模板，但不能绕过角色原型、权限上限和输出约定。

项目启动时绑定不可变团队版本。修改模板会创建新版本，不改变已启动项目；每次运行仍创建独立 Session。

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
| M4 | 整合管理界面、PostgreSQL、实时事件与 HQ；M4.4 使用真实运行证据完成大屏回放验收 |
| M5 | 完成 Agent 注册与版本、工作流控制结构、自适应 Self-loop、智能配队、异常测试、部署、性能工作与比赛材料 |

每个里程碑交付设计、实现、测试、验收报告和遗留问题。可观察验收标准通过前，不进入下一里程碑。

### M5 initial-round plan

M5 以初赛可验收为边界，按依赖顺序完成以下阶段，不并行启动会互相冲突的改版。

**M5.0 基线与证据矩阵。** 把截图中的赛题要求映射到现有实现、待补模块、真实测试与报告章节，冻结 M4 已验证的调度、验证、持久化和 HQ 行为。门禁是每项要求都有明确 owner、验收命令和现有或计划中的证据，不能用“已有类似能力”代替证据。

**M5.1 Agent Registry 与版本。** 将固定 `defaultAgentProfiles()` 改为已发布定义的种子数据。Agent 定义保存角色、提示词版本、模型、能力、工具白名单、记忆策略、并发容量和输入输出 schema；生命周期为 `DRAFT → VALIDATED → PUBLISHED → DEPRECATED`。调度器按能力查询已发布版本，团队绑定不可变定义版本。项目级记忆只保存结构化需求、设计决策、失败签名和已接受产物摘要，不使用向量数据库。门禁覆盖注册、发现、版本不可变、弃用、能力查询和项目冻结。

**M5.2 工作流控制结构。** 保留任务 DAG，同时增加显式控制图，支持顺序、并行、条件分支、有界循环与子工作流。首个真实控制图固定为：验证 `PASS` 进入交付；`FAIL` 或 `INCOMPLETE` 进入 Repair 子工作流；Repair 完成后回到验证；达到三轮或重复失败签名时升级。条件、循环轮次、子工作流进入与退出均持久化并映射到 React Flow。初赛只提供版本化工作流定义和可视化查看，不做任意拖拽编排器。

**M5.3 自适应 Self-loop。** 根据验证 finding 分类失败并选择预定义修复策略。策略选择考虑失败类别、轮次、历史失败签名与已执行修改；每项策略声明提示词片段、上下文范围、现有工具权限和复验范围。系统保存候选策略、选择理由、输入摘要、修复结果和下一轮变化。相同签名再次出现时先切换策略，仍重复或耗尽轮次则 `ESCALATED`。策略只能改变修复上下文和现有工具使用，不能降低 Verifier 阈值。

**M5.4 智能配队。** 在 Registry 和工作流模板完成后实现小白入口。用户描述目标，系统生成项目画像，最多询问三个必要问题，再从已发布 Agent 定义和团队模板中推荐完整编制。推荐通过能力覆盖、并发容量、工具权限、记忆策略和输出约定校验；用户可一键采用、自然语言调整并保存新团队版本。

**M5.5 平台整合与真实 E2E。** 新增 Agent 注册、团队发布、工作流控制、策略选择和项目记忆的 REST、Socket.IO 事件与管理界面。真实 DeepSeek E2E 必须从已发布 Agent 与团队启动，实际经过一次条件分支、有界循环和 Repair 子工作流，验证失败后由自适应策略修复并最终 PASS；浏览器覆盖桌面与移动视口，禁止使用模拟 Agent 响应作为门禁证据。

**M5.6 初赛交付。** 完成异常测试、部署、性能测量、赛题证据矩阵、技术方案、幻灯片、演示视频与复现步骤。所有材料引用真实运行记录、测试输出和截图，不把计划中能力写成已实现结果。

初赛明确后置 MCP、A2A、外部 API 插件、RAG、向量数据库、任意工具安装、完整拖拽工作流编辑器、Agent 市场、多租户与计费。现有只读文件工具、TypeScript/Vite/Playwright 工具链、数据库事件和工具权限记录继续作为工具使用证据；文档必须明确这些边界，不宣称尚未接入 MCP。

### M5.1 and M5.2 results

- Agent Registry 现在持久化定义、独立版本状态、发布与弃用、能力发现、团队编制、项目记忆和完整项目冻结绑定。发布定义可继续登记新版本，旧版本保持不可变；弃用后不再参与发现，但已冻结项目仍使用原成员快照。
- SQLite schema v6 与 PostgreSQL 迁移保存 Registry、团队、项目记忆和工作流控制记录。项目创建在同一事务中写入冻结团队与初始需求记忆，SQLite 与 PostgreSQL 均通过恢复、版本、外键和唯一约束测试。
- 默认团队从七个受控定义生成：Planner、UI Designer、Tester、Frontend、Integration、Verifier 与 Repair，其中 Frontend 版本实例化两次；确定性 Verifier 由系统拥有，不计入运行时成员或 HQ 小人。平台启动会恢复或被中断的默认种子修复为完整团队。
- 项目启动器从项目冻结快照派生 scheduler profiles，模型、提示词、能力、工具白名单、记忆策略和输出契约来自不可变 Agent 版本；Bash 与 PowerShell 继续禁用。
- 版本化工作流控制图支持顺序、并行、条件、有界循环、Repair 子工作流和终态。每次节点进入/完成、边选择、循环评估和子工作流进出均写入 Journal，快照 revision 防止旧状态覆盖。
- Self-loop 已接入控制图：PASS 进入交付，FAIL 或 INCOMPLETE 进入 Repair 子工作流，Repair 返回验证；重复失败、三轮耗尽、Repair 失败或验证不完整进入可见升级。管理界面在任务 DAG 下展示控制图与最近控制事件。
- 聚焦结果为编排包 88/88、平台包 25/25、UI 50/50 测试通过；真实 PostgreSQL E2E 2/2 通过，覆盖 Registry 恢复、团队冻结、项目记忆、工作流控制以及原有事务/租约路径。

### M5.3 and M5.4 results

- SQLite schema v7 与 PostgreSQL migration `20261101200000` 保存每轮修复策略决策、候选评分、选择理由、输入摘要、结果和关联 Repair 记录。
- 自适应策略目录按 TypeScript、依赖与构建、浏览器、可访问性与响应式、控制台与网络、服务器、项目结构和有界回归分类；策略只改变提示词与有界源码上下文，复验范围固定为完整验证流水线。
- 工作流控制快照新增 `strategySwitchAvailable`。同一失败签名再次出现时，系统先选择未使用过的策略并继续 Repair；没有替代策略或达到三轮上限时升级。修复 Agent 超时、失败和复验异常都保留策略结果与 Repair 记录。
- 智能配队从自然语言需求生成项目画像，最多提出三个结构化问题，只从已发布 Agent 定义版本和团队模板推荐完整编制。推荐确定性校验能力、并发、工具、记忆和输出契约，并显示缺失能力与风险。
- 用户可应用受控自然语言调整、保存不可变团队版本，或采用团队并创建已冻结项目。管理前端增加“智能配队”入口、项目画像、成员与能力覆盖、风险、调整历史和采用流程。
- 新增模块达到 per-file 100% 覆盖：`adaptive-repair.ts`、`self-healer.ts`、`team-recommender.ts`、`TeamBuilderPage.tsx`、`TeamRecommendationDetails.tsx`、`recommendation-labels.ts` 与 `RepairsPage.tsx`。
- 当前聚合结果为编排包 169/169、平台包 26/26、UI 73/73 测试通过；包级 TypeScript、Prisma schema、目标文件 Oxlint 与 `git diff --check` 通过。

### M5.5 团队库结果

- SQLite schema v8 与 PostgreSQL migration `20261102130000` 新增逻辑团队归属、每实例一行运行时成员、不可变版本状态与稳定 HQ 工位字段。
- 用户可以创建多个团队、保存空草稿、发布 1–7 个运行时实例、复制已发布团队、归档团队并查看项目引用。同一已发布 Agent 版本可以出现多次，每个实例都占用团队人数。
- 团队发布与智能推荐共用能力、并发、工具、记忆、输出契约、部门和发布状态校验。确定性 Verifier 仍由系统拥有，不属于团队成员。
- 项目创建冻结所选团队版本；项目 Agent 接口从冻结快照派生名单，HQ 读取冻结的部门与工位，而不是根据角色字符串猜测。
- “我的团队”管理页提供团队列表、版本历史、容量与引用摘要，以及 1–7 实例编辑器；既有“智能配队”仍作为推荐入口。
- 当前聚焦结果为编排包 198/198、平台包 32/32、UI 87/87 测试通过；真实团队 E2E 在无密钥时安全跳过，SQLite v1–v7 迁移测试、Prisma schema、TypeScript 检查与构建产物检查通过。
- 2026-11-03 的真实 DeepSeek E2E 从用户复制并发布的 7 人团队创建项目，验证了不可变冻结快照、7 个项目 Agent 投影、7 个独立 Harness home、真实生成 Session，以及桌面与移动浏览器验证。项目先通过完整验证，再通过平台接口注入 `TS2322`；自适应修复完成新的 Repair Session，复验结果由 `FAIL` 转为 `PASS`，控制图记录条件边、有界循环、Repair 子工作流和 `PASSED` 终态。证据保存在 `.artifacts/future-cup-m55-live/real-team-*/run-result.json`，测试入口为 `packages/experimental/future-cup-platform/tests/real-team-library.e2e.ts`。
- Browser Verifier 现在会在每个交互前重新进入该交互声明的 `fromRoute`，避免前一个导航污染后一个交互的起始页面。Tester 输出也会拒绝既不属于源页面 `requiredText`、也不等于目标页面 `navigationLabel` 的 `clickText`。SDK 将失败的 `turn/end` 暴露为带稳定错误码和可重试分类的 `SessionTurnError`，Self-loop 使用 `maxAgentRetries` 对可恢复传输失败进行有界重试；回归测试覆盖同源多交互、矛盾文案和传输恢复。

### M1、M2、M3、M4.0、M4.1、M4.2、M4.3、M4.4、M5.1、M5.2、M5.3 与 M5.4 结果

M1 已于 2026-10-30 完成。官方 TypeScript SDK 启动了真实 Harness runtime，真实 DeepSeek 模型完成了轮次，真实模型生成了 React、TypeScript、Vite 与 Ant Design 工程。后续真实模型轮次安装依赖并运行生产构建；独立 Playwright 验证在桌面与移动视口通过，计数器交互正常。

- Harness 原生 Workflow 可用，但缺少持久 DAG 状态、journaling、resume 与调度；M2 使用 Harness 执行原语与自研轻量 DAG。
- Windows ACL 通过了写入限制测试，但仍是同内核的部分隔离，不能作为不可信或多租户代码的最终边界。
- Docker 29.7.2 与 SWE-ReX 1.4.0 在验证主机上通过了容器 Runtime、持久 shell、文件访问、内存、CPU、PID、网络与清理检查。
- SWE-ReX 1.4.0 需要显式安装 `aiohttp`，其管理 bridge 必须与严格执行网络策略结合。
- M2 实现了实验性 Future Cup 编排包：SQLite 任务修订与 Journal、环检测、就绪传播、失败阻断、恢复、可解释加权调度、负载均衡、重新分配、执行记录与结构化 Agent 契约。
- 真实 DeepSeek E2E 让 Planner、UI Designer、两个并行 Frontend Agent 与 Integration 在独立 Session 中运行。生成的 React/TypeScript/Vite/Ant Design 工程通过 TypeScript 与 Vite 生产构建。
- M3 将 SQLite schema 升级到 v2，新增结构化验证报告、确定性失败签名、`repair_records`、`workflow_runs` 与 M2 数据原地迁移。
- Tester 在独立 Session 中生成路由、可见文本与导航交互断言。独立 Verifier 顺序运行工程结构、依赖安装、`tsc --noEmit`、Vite build，以及桌面与移动 Playwright 检查；`pageerror`、`console.error`、Ant Design 弃用告警、失败请求和 HTTP 4xx/5xx 均可阻止 PASS。
- 有界 Self-loop 每次修复后重新运行完整验证，保存真实源码 Diff 和修复前后状态；显式配置控制最大轮次与超时，重复失败签名、超时、验证环境不完整或轮次耗尽都会落盘为可见 `ESCALATED` 状态。
- 真实 DeepSeek M3 E2E 先完成六个独立生成 Session，再注入确定性 TypeScript 错误。Playwright 随后捕获另一项真实浏览器失败。两个独立 Repair Session 分别移除构建错误并修复用户管理页可见断言，最终工程通过 TypeScript、Vite、桌面与移动浏览器验证。
- M4.0 已在真实 PostgreSQL 17.11 与 Prisma 7.10.1 上验证 migration、Serializable 事务、项目级事件序号、事务 Outbox、跨进程租约、fencing token、外键与回滚。真实 Harness SDK 在 run 完成前投递了 Agent 状态、`tool/call` 与 `tool/result` 通知。`dsh` 可从 Web 模板创建自定义 profile。
- HQ 实际路径为 `agent-display-main/theme-10-hq`，采用 PolyForm Noncommercial License 1.0.0，必须保留 `Required Notice: Copyright (c) 2026 赛博老爸`。当前大屏明确标注本地模拟，尚未连接实时事件。
- M4.1 为 SQLite 与 PostgreSQL 实现同一 `OrchestrationStore` 约定。PostgreSQL 现在可持久化 DAG revision、调度决策、执行、执行事件、验证报告、修复与工作流状态，而不只是快照。
- 任务写入要求匹配前一 revision；项目事件与 Outbox 义务在同一 Serializable 事务中提交。Outbox dispatcher 使用过期 owner claim，PostgreSQL 通过 `FOR UPDATE SKIP LOCKED` 领取。
- Fastify 现在提供项目、任务、执行事件、调度、验证、修复、工作流、启动与取消路由，并包含 Zod 校验及明确的 400、404、409、503 失败。Socket.IO 按 `projectId + afterSeq` 重放快照与已提交增量，非法游标以 `INVALID_CURSOR` 断开。
- 真实 PostgreSQL 迁移与 E2E 测试通过 DAG 写入、revision Journal、执行证据、验证、修复、工作流完成、并发事件序号、Outbox claim、重连查询与跨进程 fencing。
- Future Cup bundle 通过 `dsh` 完成组合，真实平台 API 已在 PostgreSQL 上提供 health、Agent、项目创建与 snapshot 路由。M4.2 随后增加管理界面，以及消费该仓储约定的具体运行启动器。
- M4.2 新增 `project_runs`、SQLite schema v5、PostgreSQL migration，并限制每个项目只有一个活跃运行。运行状态与 M3 验证工作流分开保存。
- 真实 `FutureCupRunLauncher` 创建隔离 workspace 与 Agent home root，获取并续期 workflow lease，运行真实 Harness 团队，在进程重启后回收中断运行，并记录 PASSED、FAILED、CANCELLED 或 ESCALATED，不使用模拟状态。
- SQLite 与 PostgreSQL 现在会在拥有状态的事务中写入任务、执行、验证、修复、工作流与运行产品事件。任务完成与执行结算也共享同一事务。
- 真实启动器的每次领域写都携带 workflow owner 与 fencing token。终态结算在短暂数据库错误期间保持 heartbeat 重试，能识别“提交成功但响应丢失”的终态行，并以 `PROJECT_RUN_SETTLEMENT_PENDING` 或 `PROJECT_RUN_SETTLEMENT_TIMEOUT` 报告未完成状态，不伪装成功。
- 同源管理 SPA 使用 React、TypeScript、Vite、Ant Design、React Flow、HashRouter 与 Socket.IO，提供项目创建与控制、Agent 状态、DAG、调度证据、验证截图、修复 Diff、事件日志与交付预览。
- 项目级 Agent 卡片从 `RUNNING` 执行记录计算当前负载，从持久化执行结果计算历史成功率；权威事件游标推进时，界面会刷新该投影。
- Fastify 托管构建后的管理 SPA、截图产物与生成工程生产预览。公共响应以相对标识替代私有 workspace 路径，截图文件名只能通过受控路由访问。
- 最终真实 M4.2 运行通过八个独立 Session 完成五个 DAG 任务，经两次真实 Repair Session 后通过，并在平台预览路径下提供生成工程生产构建。桌面、900 px 平板与 390 px 移动浏览器验证均通过，采集十一张截图，无失败请求或图片解码错误。
- M4.3 已将真实 REST/Socket.IO 数据接入符合 PolyForm Noncommercial License 1.0.0 的 HQ 3D 大屏。页面通过共享判别联合校验项目事件，按 `projectId + seq` 去重，在序号缺口时重新读取权威快照，并按项目游标恢复实时流。
- 实时事件通过独立动作映射驱动场景动画：调度文件在部门间飞行，Agent 会起立走动、进入工作与工具调用状态，验证失败、修复往返和最终交付使用不同色调与脉冲。REST 首次加载、重连快照和缺口重同步只重建状态，不重播历史动画。
- HQ 构建产物包含 `/hq/index.html`、`/hq/hq-bridge.js`、许可证与 Required Notice；管理应用增加项目级“实时大屏”入口。页面移除本地预置项目、远程字体及新增任务/人员入口，成为只读执行视图。
- HQ 将七个真实 Agent 角色映射到规划、设计、页面 A、页面 B、集成、验证与自愈部门；项目、任务、负载、验证与修复状态均来自持久化快照和已提交事件。
- 聚焦 UI 测试、类型检查、HQ 构建与产物服务测试通过；浏览器在 1920×1080 与 390×844 视口验证了空项目参数错误态、真实快照投影、Socket.IO 序号缺口重同步、实时事件动作调用与响应式布局。
- M4.4 将 M4.2 真实 DeepSeek 多 Agent 运行的 53 条已提交事件固化为确定性回放夹具，并验证全部事件通过共享判别联合、最终 5/5 任务完成、2 轮修复、验证与运行均 `PASSED`。
- 真实运行回放产生 57 个 HQ 场景动作：Agent 21、部门 17、流程飞行 17、终态 2；重复终态事件不产生额外状态或动画。桌面与移动浏览器显示 `PASSED · 53`，无控制台错误。
- M4.4 随后使用真实 DeepSeek 密钥与远程 PostgreSQL 17.11 完成全新 E2E：`deepseek-flash` 生成团队使用 9 个独立 Session 完成 5/5 任务，验证状态为 `FAIL → FAIL → FAIL → PASS`，3 轮 Repair 后运行与工作流均 `PASSED`，最后事件序号为 `59`。
- HQ 在全新运行中观察到 53 个实时动作，最终显示 `PASSED · 59`、100% 进度和 3 轮修复。桌面与移动浏览器均使用 WebGL2 且控制台零错误；首帧相机悬停竞态已修复。新鲜运行证据保存在 `.artifacts/future-cup-m44-live/`。
- 生成工程生产预览在桌面与移动视口均返回 HTTP 200，实际渲染 `Overview`、`Users` 导航和 KPI/活动内容，控制台零错误。

详细技术门禁见 [Future Cup M4 realtime persistence gate](../architecture/2026-10-31-future-cup-m4-realtime-persistence-gate.zh.md)。

## Alternatives considered

**保留此前的微前端与 H5 编排场景。** 已否决，因为方案 V1.0 已把产品改为前端工程交付。此前场景优化的是不同交付物、工作流与演示，继续把它作为当前记忆会把实现引向错误产品。

**构建通用 AI 网页生成器。** 已否决，因为竞赛评估编排、调度、验证与 self-loop，而不是一次性代码生成。没有可观察多 Agent 控制面的生成器属于薄模型应用。

**优先构建通用 Agent 市场。** 已否决，因为任意 Agent 创建、计费、多租户和广泛集成不能证明所需的前端失败到恢复路径，并会超出 MVP。

**让小白用户从空白页面创建单个 Agent 或完全自由的团队。** 已否决，因为用户缺少角色划分、工具权限和失败恢复知识。M5 以完整团队为产品单位，默认从已验证模板和受控角色库推荐编制，高级编辑不能绕过校验。

**由模型自由发明任意 Agent 团队。** 已否决，因为不可重复的团队无法稳定审计、授权和复现。模型只提取项目画像与给出建议，确定性规则负责能力覆盖、容量、权限和输出约定的最终校验。

**在初赛阶段新增 MCP、A2A、外部 API 插件、RAG 或向量记忆。** 已否决，因为赛题将它们列为鼓励项而非初赛硬门禁。时间应先补齐 Agent 注册、工作流控制与自适应反馈，现有受控工具链和工具事件足以提供真实工具使用证据。

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
- 小白用户可从自然语言需求获得完整团队推荐，最多回答三个必要问题，不需要从空白 Agent 配置开始。
- 团队推荐只使用受控角色原型，并通过能力覆盖、并发容量、工具权限和输出约定的确定性校验；缺失或不支持的能力必须明确显示。
- 用户可一键采用、用自然语言调整并保存团队版本；项目启动后冻结版本，同一版本的运行可以复现，后续编辑不会污染正在进行或已完成的运行。
- 推荐的团队至少完成一次真实多 Agent E2E，证明推荐、实例化、独立 Session、并行执行和最终验证使用同一份冻结编制。
- Agent 定义能够注册、校验、发布、按能力发现和弃用；版本不可变，团队引用已发布版本，项目启动后冻结团队与全部成员定义。
- 工作流控制图实际执行条件分支、有界循环与 Repair 子工作流，恢复后保持相同控制状态，并在管理界面提供可检查证据。
- 验证失败会触发显式修复策略选择；相同失败签名再次出现时发生策略切换，后续仍重复或耗尽轮次则升级，策略记录可审计且不能降低验证标准。
- M5 真实 E2E 证明注册、团队发布、项目绑定、条件循环、自适应修复、最终 PASS、刷新恢复和 HQ 事件来自同一真实运行。
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
- 团队推荐可能退化为不可解释的黑盒或只对少数演示需求有效。角色库、匹配规则、缺失能力与选择理由必须可检查，并用多个项目画像验证。
- 自定义团队可能绕过执行安全或形成无效编制。角色原型、工具权限上限、并发容量和输出约定必须由确定性规则约束，失败时阻止启动。
- Agent Registry 和工作流控制可能扩张成通用平台。初赛只支持已批准定义、固定控制结构和版本化定义，不做任意角色、任意工具或完整拖拽编排。
- 自适应策略可能通过弱化验证来伪造成功。策略只能选择修复上下文与现有工具，Verifier 阈值和完整复验范围必须由独立代码固定。
- 不接入 MCP 可能被误解为没有工具使用。报告必须展示既有只读工具、TypeScript/Vite/Playwright、数据库事件和 `tool/call` 证据，并明确 MCP 是初赛后置项。
- M5 同时承担配队、部署、性能和比赛材料，范围可能过大。各子阶段必须独立通过门禁，不能以演示材料掩盖缺失的真实运行证据。
- 超出 React MVP 或引入多个工作流引擎会分散实现精力，并产生相互冲突的执行真源。
