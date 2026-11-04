---
description: "Future Cup 管理应用、真实 Harness 团队启动器、实时事件与 Prisma PostgreSQL 持久化。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-future-cup-platform

[English](README.md) | 中文

## 概述

以 `dsh` 插件运行 Future Cup 管理平台：为 SQLite 与 PostgreSQL 提供共享编排仓储、版本化 Agent Registry、项目团队冻结、可恢复工作流控制、可解释自适应修复策略、小白智能配队、真实 Harness 团队启动器、事务性项目事件与 Outbox、Fastify REST 快照、Socket.IO 重放、同源 React 管理应用，以及只读的 HQ 3D 大屏。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在命名 `dsh` profile 中挂载本组合包。profile 拥有 Fastify 与 Socket.IO 生命周期；本包不新增独立可执行程序。

组合包读取 `FUTURE_CUP_PORT`、`FUTURE_CUP_DATABASE_URL`、`FUTURE_CUP_SQLITE_PATH`、`FUTURE_CUP_RUN_ROOT`、`FUTURE_CUP_AGENT_HOME_ROOT`、`FUTURE_CUP_PROVIDER` 与 `FUTURE_CUP_MODEL`。PostgreSQL 是配置后的生产适配器，SQLite 继续用于确定性本地运行与测试。

```yaml
- id: future-cup-platform
  name: '@deepseek-ai/dsh-experimental-future-cup-platform'
  config:
    host: 127.0.0.1
    port: 3090
    databaseDriver: postgres
    databaseUrl: !!js process.env.FUTURE_CUP_DATABASE_URL
    outboxPollMs: 100
    outboxBatchSize: 100
    outboxClaimMs: 30000
    workspaceRoot: .artifacts/future-cup-runs
    agentHomeRoot: .artifacts/future-cup-agent-homes
    runMaxTokens: 32000
    runRequestTimeoutMs: 600000
    verificationBuildTimeoutMs: 600000
    verificationBrowserTimeoutMs: 60000
    maxRepairRounds: 3
    repairTimeoutMs: 600000
    maxAgentRetries: 1
    leaseDurationMs: 60000
    heartbeatIntervalMs: 15000
    settlementRetryMs: 1000
    settlementWaitMs: 30000
```

启动 profile 前应用仓库内 PostgreSQL 迁移：

```sh
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform exec prisma migrate deploy
```

### REST API

服务器只绑定 loopback 主机。当前路由如下：

| 方法 | 路由 | 结果 |
|---|---|---|
| `GET` | `/api/v1/health` | 服务器状态与项目数 |
| `GET` | `/api/v1/projects` | 项目摘要与事件游标 |
| `POST` | `/api/v1/projects` | 根据名称与需求创建项目 |
| `POST` | `/api/v1/projects/:projectId/derivations` | 创建并启动不可变的升级或重新生成后继项目 |
| `GET` | `/api/v1/agent-definitions` | Agent 定义、版本与版本状态 |
| `POST` | `/api/v1/agent-definitions` | 注册 DRAFT Agent 定义 |
| `POST` | `/api/v1/agent-definitions/:definitionId/versions` | 注册不可变 Agent 版本 |
| `POST` | `/api/v1/agent-definitions/:definitionId/versions/:versionId/validate` | 校验 Agent 版本 |
| `POST` | `/api/v1/agent-definitions/:definitionId/versions/:versionId/publish` | 发布 Agent 版本 |
| `POST` | `/api/v1/agent-definitions/:definitionId/deprecate` | 弃用 Agent 定义 |
| `POST` | `/api/v1/agent-definitions/discover` | 按能力、角色和标签发现已发布版本 |
| `GET` | `/api/v1/agent-teams` | 团队版本列表 |
| `POST` | `/api/v1/agent-teams` | 校验并创建不可变团队版本 |
| `GET` | `/api/v1/teams` | 分页查询当前用户的逻辑团队 |
| `POST` | `/api/v1/teams` | 创建用户拥有的逻辑团队 |
| `GET` | `/api/v1/teams/:teamId` | 读取单个团队摘要 |
| `GET` | `/api/v1/teams/:teamId/versions` | 查询不可变团队版本 |
| `POST` | `/api/v1/teams/:teamId/versions` | 创建可编辑团队草稿 |
| `POST` | `/api/v1/teams/:teamId/versions/:versionId/publish` | 校验并发布团队草稿 |
| `POST` | `/api/v1/teams/:teamId/clone` | 将已发布团队复制为新草稿 |
| `POST` | `/api/v1/teams/:teamId/archive` | 归档逻辑团队 |
| `GET` | `/api/v1/teams/:teamId/usage` | 查询冻结到团队的项目 |
| `GET` | `/api/v1/projects/:projectId/agents` | 项目级 Agent 容量、实时负载、终止执行计数与已观测成功率 |
| `GET` | `/api/v1/projects/:projectId/team` | 项目冻结的完整团队快照 |
| `POST` | `/api/v1/projects/:projectId/team-binding` | 为未绑定项目冻结团队版本 |
| `GET` | `/api/v1/projects/:projectId/snapshot` | 当前项目状态与 `afterSeq` 后的事件 |
| `GET` | `/api/v1/projects/:projectId/events` | `afterSeq` 后的有序项目事件 |
| `GET` | `/api/v1/projects/:projectId/tasks` | 有序任务快照 |
| `GET` | `/api/v1/projects/:projectId/tasks/:taskId` | 单个任务快照 |
| `GET` | `/api/v1/projects/:projectId/scheduler-decisions` | 可解释调度决策 |
| `GET` | `/api/v1/projects/:projectId/executions` | Agent 执行记录 |
| `GET` | `/api/v1/projects/:projectId/executions/:executionId/events` | 有序执行事件 |
| `GET` | `/api/v1/projects/:projectId/verification-reports` | 独立验证报告 |
| `GET` | `/api/v1/projects/:projectId/repairs` | 修复轮次与 unified diff |
| `GET` | `/api/v1/projects/:projectId/repair-strategies` | 自适应修复候选、选择理由与结果 |
| `GET` | `/api/v1/projects/:projectId/workflow` | 当前工作流处置 |
| `GET` | `/api/v1/projects/:projectId/workflow-control` | 条件、循环与子工作流控制快照 |
| `GET` | `/api/v1/projects/:projectId/workflow-control/events` | 工作流控制 Journal |
| `GET` | `/api/v1/projects/:projectId/runs` | 项目运行历史 |
| `GET` | `/api/v1/runs/:runId` | 单个公共项目运行 |
| `POST` | `/api/v1/projects/:projectId/runs` | 启动真实 Harness 团队运行 |
| `POST` | `/api/v1/projects/:projectId/cancel` | 关闭当前 Harness 团队并取消运行 |
| `GET` | `/api/v1/projects/:projectId/delivery` | 公共交付摘要与截图地址 |
| `GET` | `/api/v1/projects/:projectId/screenshots/:fileName` | 单张已记录验证截图 |
| `GET` | `/preview/:projectId/*` | 生成工程生产构建预览 |
| `GET` | `/hq/index.html?projectId=:projectId` | 从 REST 与 Socket.IO 投影的只读 HQ 大屏 |
| `POST` | `/api/v1/team-recommendations/profile` | 从小白需求生成结构化项目画像与最多三个澄清问题 |
| `POST` | `/api/v1/team-recommendations` | 从已发布 Agent 与团队模板推荐完整团队 |
| `POST` | `/api/v1/team-recommendations/adjust` | 重放受控自然语言团队调整 |
| `POST` | `/api/v1/team-recommendations/save` | 保存不可变推荐团队版本 |
| `POST` | `/api/v1/team-recommendations/adopt` | 保存团队并创建已冻结项目 |

已挂载 profile 在 `/` 提供管理 SPA。REST 与 Socket.IO 继续在同一来源的专用路径提供。

### 实时重放

使用路径 `/future-cup/socket.io` 与认证值 `{ projectId, afterSeq }` 连接 Socket.IO。服务器加入项目房间，加载 `sync.snapshot`，随后只从尚未发布的 Outbox 行发送已提交的 `project.event`。

每个事件包含 `projectId`、项目内正数 `seq`、`occurredAt`、`type` 与 JSON payload。客户端按 `projectId + seq` 去重，并使用最后应用的序号重连。

HQ 大屏使用共享判别联合校验事件，只应用已提交事件，检测序号缺口，并在继续同步前重新读取权威 REST 快照。实时事件通过独立动作映射驱动部门间飞行、Agent 工作脉冲、验证告警、修复往返与交付动画；快照重载和重复事件不会重播动画。页面不包含本地项目预置，也不提供新增任务或人员入口。

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Cordis 插件、显式配置、存储选择与生命周期 |
| `src/server.ts` | Fastify 路由、Socket.IO 重放、Outbox 轮询与关闭 |
| `src/run-launcher.ts` | 真实 Harness 团队启动、租约心跳、取消与运行结算 |
| `src/project-derivation.ts` | 不可变项目后继、冻结团队继承与项目记忆派生 |
| `src/delivery-snapshot.ts` | 已通过项目的源码快照，排除依赖、构建产物、密钥与链接 |
| `src/adaptive-repair.ts` | 根据验证 finding 选择受控修复策略并保留候选评分 |
| `src/team-recommender.ts` | 项目画像、澄清、完整团队推荐与受控调整 |
| `src/artifact-server.ts` | 管理资源、截图、交付与生成工程预览 |
| `src/postgres-store.ts` | 共享编排仓储的 Prisma PostgreSQL 适配器 |
| `ui/src/hq/` | HQ 状态投影与 REST/Socket.IO 桥接 |
| `ui/src/hq/animation.ts` | 产品事件到真实场景动作的纯映射 |
| `ui/src/pages/TeamBuilderPage.tsx` | 自然语言需求、澄清、推荐、调整与采用团队入口 |
| `ui/src/pages/MyTeamsPage.tsx` | 用户团队库与 1–7 人运行时成员编辑器 |
| `ui/public/hq/` | PolyForm 许可的 3D 场景、许可证与上游说明 |
| `prisma/schema.prisma` | PostgreSQL 表、索引、外键与 JSONB 字段 |
| `prisma/migrations/` | 仓库内 PostgreSQL 迁移 |

SQLite 与 PostgreSQL 实现同一组 `OrchestrationStore` 操作。任务更新要求匹配前一 revision，旧写入者不能覆盖较新的 DAG 状态。项目事件与 Outbox 义务在同一 Serializable 事务中提交。Dispatcher 使用带过期时间的 owner token 领取 Outbox 行；PostgreSQL 使用 `FOR UPDATE SKIP LOCKED`。

平台启动时从持久 Registry 重放定义、版本、团队和项目绑定，并恢复固定默认团队。新项目必须在同一事务中写入完整团队快照和初始需求记忆；后续 Registry 发布新版本不会改变已启动项目。项目运行从冻结团队派生 scheduler profiles，模型、提示词、能力、工具白名单、记忆策略与输出契约均来自该项目版本。

`workflow_control_runs` 保存完整控制快照，`workflow_control_events` 追加节点、边选择、循环与子工作流事件。每个快照带 revision，持久化层拒绝旧 revision 覆盖；Self-loop 的 PASS、Repair 返回验证、重复失败和基础设施升级都会更新该控制状态。

`repair_strategy_decisions` 在 Repair Agent 修改源码前保存候选策略、评分项、选择理由、上下文范围与复验范围。策略只能改变提示词和读取上下文，复验固定为完整结构、构建和浏览器流水线。相同失败签名再次出现时先选择未使用过的策略；没有替代策略或达到三轮上限时升级。

智能配队入口只从已发布 Agent 版本和已发布团队模板推荐完整编制，并确定性校验能力覆盖、并发、工具、记忆和输出约定。用户最多回答三个澄清问题，可以用受控自然语言调整，再保存不可变团队版本并冻结到新项目。

工作流租约保存 owner、heartbeat、expiry 与单调 fencing token。租约接管会递增 token，只有当前 owner 与 token 能续期或释放。领域写会在自身事务内校验该 fence。新启动在接管过期租约后会回收遗留 `RUNNING` 行；没有进程内运行记录的取消请求也会接管过期租约，并把持久任务、执行与运行结算为 `CANCELLED`。

项目级 Agent 状态从 `RUNNING` 执行记录计算实时负载。历史成功率以 `COMPLETED` 为成功，并把 `FAILED` 与 `CANCELLED` 计入执行总数。没有执行记录旧项目会回退到已分配任务和终止状态的修复记录。接口同时返回成功数与终止执行数，管理界面据此区分真实观测值与 Agent 没有历史数据时使用的配置默认值。

“我的团队”入口独立管理逻辑团队。团队版本包含 1–7 个运行时实例；重复的已发布 Agent 版本按多个成员计数，每个实例拥有稳定显示名、部门与工位。草稿可以为空，但发布必须通过推荐器使用的同一套能力与策略校验。项目创建时冻结所选版本，项目 Agent 接口投影该冻结名单，因此 HQ 大屏的人数与部门位置严格一致。

项目派生保持旧项目不可变。后继项目记录来源项目、来源的已通过运行、派生模式与可选升级需求，继承完全相同的冻结团队快照与项目记忆，并启动自己的独立运行。`UPGRADE` 在 Agent 团队执行前恢复来源交付快照；`REGENERATE` 从空工作区开始。来源项目及其证据不会被改写。

HQ 的普通部门进度来自 DAG 任务，自愈部进度来自持久 Repair 轮次。因此 Repair 作为控制子流程执行时，完成记录仍会更新自愈部，而不要求它成为普通 DAG 任务。

## Model Experience

### Platform data plane

#### What the model sees

无。本包不注册 prompt section、工具 schema、Session 记录或模型请求字段。Agent 包拥有各自的模型可见输入。

#### Token effect

直接 token 影响为零。

#### KV Cache effect

本包不会使可复用请求前缀失效。模型适配器与拥有提示词的包决定缓存复用。

## Known Limitations and Deferred Work

- **没有 mid-turn cancel：** Harness TypeScript SDK 没有 prompt-cancel 请求。取消会关闭运行拥有的 runtime、等待结算并记录 `CANCELLED`。
- **每个项目一次生成：** 当前 MVP 为每个项目保留一组任务。终态运行后如需重新生成，请新建项目。
- **高级 Registry 编辑器延后：** 小白配队入口已覆盖推荐、调整、保存与采用；任意角色、任意工具和自由团队编辑器仍属于 M5.5 之后的工作。
- **Loopback 传输：** 服务器拒绝非 loopback 主机。带认证的公网部署与 TLS 终止仍属于部署工作。
- **单一存储生命周期：** 关闭服务器会关闭其拥有的存储。消费者不得在关闭后继续共享该实例。
- **Outbox 至少一次投递：** Dispatcher 崩溃后，claim 过期会触发重放。客户端必须按 `projectId + seq` 去重。
- **结算恢复：** 短暂数据库失败期间，工作流租约保持有效并持续重试终态结算。永久失败或有界关闭超时会让持久化运行保留为 `RUNNING`，由下一次启动或取消请求回收。如果其他 worker 仍持有未过期租约，取消会报告 `PROJECT_RUN_SETTLEMENT_PENDING`；没有终态持久记录时不能报告成功。
- **Ant Design 包较大：** 管理应用当前生成约 1 MB 的 Ant Design chunk。页面已按路由懒加载，组件级拆包仍属于性能工作。
- **HQ 资产为非商业许可：** HQ 场景继续采用 PolyForm Noncommercial License 1.0.0。每份分发都必须保留许可证与 Required Notice；商业用途需另行取得授权。

<a id="dev-note"></a>
### 开发备注

PostgreSQL 客户端在包安装期间生成到被忽略的 `src/generated/`。修改 schema 后运行 `prisma generate`；启动组合包前，对可访问的 PostgreSQL 数据库运行 `prisma migrate deploy`。M5 的 `20261101160000`、`20261101173000`、`20261101200000` 与 `20261102130000` 迁移共同建立 Registry、逻辑团队、每实例一行运行时成员、项目记忆、工作流控制与自适应修复策略表。

使用 `pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/future-cup-platform/tests/real-team-library.e2e.ts` 运行需要密钥的 M5.5 真实团队验收。没有 `DEEPSEEK_API_KEY` 时测试会自动跳过；运行摘要与截图写入 `.artifacts/future-cup-m55-live/real-team-*`。
