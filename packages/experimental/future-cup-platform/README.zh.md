---
description: "Future Cup 管理应用、真实 Harness 团队启动器、实时事件与 Prisma PostgreSQL 持久化。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-future-cup-platform

[English](README.md) | 中文

## 概述

以 `dsh` 插件运行 Future Cup 管理平台：为 SQLite 与 PostgreSQL 提供共享编排仓储、真实 Harness 团队启动器、事务性项目事件与 Outbox、Fastify REST 快照、Socket.IO 重放，以及同源 React 管理应用。

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
| `GET` | `/api/v1/projects/:projectId/agents` | 项目级 Agent 容量、实时负载与已观测成功率 |
| `GET` | `/api/v1/projects/:projectId/snapshot` | 当前项目状态与 `afterSeq` 后的事件 |
| `GET` | `/api/v1/projects/:projectId/events` | `afterSeq` 后的有序项目事件 |
| `GET` | `/api/v1/projects/:projectId/tasks` | 有序任务快照 |
| `GET` | `/api/v1/projects/:projectId/tasks/:taskId` | 单个任务快照 |
| `GET` | `/api/v1/projects/:projectId/scheduler-decisions` | 可解释调度决策 |
| `GET` | `/api/v1/projects/:projectId/executions` | Agent 执行记录 |
| `GET` | `/api/v1/projects/:projectId/executions/:executionId/events` | 有序执行事件 |
| `GET` | `/api/v1/projects/:projectId/verification-reports` | 独立验证报告 |
| `GET` | `/api/v1/projects/:projectId/repairs` | 修复轮次与 unified diff |
| `GET` | `/api/v1/projects/:projectId/workflow` | 当前工作流处置 |
| `GET` | `/api/v1/projects/:projectId/runs` | 项目运行历史 |
| `GET` | `/api/v1/runs/:runId` | 单个公共项目运行 |
| `POST` | `/api/v1/projects/:projectId/runs` | 启动真实 Harness 团队运行 |
| `POST` | `/api/v1/projects/:projectId/cancel` | 关闭当前 Harness 团队并取消运行 |
| `GET` | `/api/v1/projects/:projectId/delivery` | 公共交付摘要与截图地址 |
| `GET` | `/api/v1/projects/:projectId/screenshots/:fileName` | 单张已记录验证截图 |
| `GET` | `/preview/:projectId/*` | 生成工程生产构建预览 |

已挂载 profile 在 `/` 提供管理 SPA。REST 与 Socket.IO 继续在同一来源的专用路径提供。

### 实时重放

使用路径 `/future-cup/socket.io` 与认证值 `{ projectId, afterSeq }` 连接 Socket.IO。服务器加入项目房间，加载 `sync.snapshot`，随后只从尚未发布的 Outbox 行发送已提交的 `project.event`。

每个事件包含 `projectId`、项目内正数 `seq`、`occurredAt`、`type` 与 JSON payload。客户端按 `projectId + seq` 去重，并使用最后应用的序号重连。

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Cordis 插件、显式配置、存储选择与生命周期 |
| `src/server.ts` | Fastify 路由、Socket.IO 重放、Outbox 轮询与关闭 |
| `src/run-launcher.ts` | 真实 Harness 团队启动、租约心跳、取消与运行结算 |
| `src/artifact-server.ts` | 管理资源、截图、交付与生成工程预览 |
| `src/postgres-store.ts` | 共享编排仓储的 Prisma PostgreSQL 适配器 |
| `prisma/schema.prisma` | PostgreSQL 表、索引、外键与 JSONB 字段 |
| `prisma/migrations/` | 仓库内 PostgreSQL 迁移 |

SQLite 与 PostgreSQL 实现同一组 `OrchestrationStore` 操作。任务更新要求匹配前一 revision，旧写入者不能覆盖较新的 DAG 状态。项目事件与 Outbox 义务在同一 Serializable 事务中提交。Dispatcher 使用带过期时间的 owner token 领取 Outbox 行；PostgreSQL 使用 `FOR UPDATE SKIP LOCKED`。

工作流租约保存 owner、heartbeat、expiry 与单调 fencing token。租约接管会递增 token，只有当前 owner 与 token 能续期或释放。领域写会在自身事务内校验该 fence。新启动在接管过期租约后会回收遗留 `RUNNING` 行。

项目级 Agent 状态从 `RUNNING` 执行记录计算实时负载，并用已完成执行记录覆盖持久化成功率。权威快照游标推进时，管理界面会刷新该投影。

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
- **Loopback 传输：** 服务器拒绝非 loopback 主机。带认证的公网部署与 TLS 终止仍属于部署工作。
- **单一存储生命周期：** 关闭服务器会关闭其拥有的存储。消费者不得在关闭后继续共享该实例。
- **Outbox 至少一次投递：** Dispatcher 崩溃后，claim 过期会触发重放。客户端必须按 `projectId + seq` 去重。
- **结算恢复：** 短暂数据库失败期间，工作流租约保持有效并持续重试终态结算。永久失败或有界关闭超时会让持久化运行保留为 `RUNNING`，由下一次启动回收；cancel 与 close 会报告 `PROJECT_RUN_SETTLEMENT_PENDING` 或 `PROJECT_RUN_SETTLEMENT_TIMEOUT`，不能伪装成功。
- **Ant Design 包较大：** 管理应用当前生成约 1 MB 的 Ant Design chunk。页面已按路由懒加载，组件级拆包仍属于性能工作。

<a id="dev-note"></a>
### 开发备注

PostgreSQL 客户端在包安装期间生成到被忽略的 `src/generated/`。修改 schema 后运行 `prisma generate`；启动组合包前，对可访问的 PostgreSQL 数据库运行 `prisma migrate deploy`。
