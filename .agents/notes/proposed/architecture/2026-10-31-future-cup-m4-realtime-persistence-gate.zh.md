# Agent Note: Future Cup M4 实时持久化门禁

Status: proposed

[English](2026-10-31-future-cup-m4-realtime-persistence-gate.md) | 中文

## 问题

Future Cup M4 要在已验证的 M3 编排闭环外围整合 PostgreSQL、Prisma、实时事件、平台管理端与 HQ 大屏。这些新增组件容易产生多个状态真源：API 进程可能在事务提交前广播，旧 Worker 可能丢失租约后继续写入，客户端重连后可能按本地猜测渲染，HQ 也可能继续把模拟活动当作正式执行。

M4.0 必须在构建产品包与界面前收敛这些风险。

## 提议

保留 SQLite 作为确定性本地适配器，同时引入领域级持久化接口与 PostgreSQL/Prisma 适配器。规范项目事件与对应事务性 Outbox 行在推进项目状态的同一事务内写入。事件 `seq` 从被锁定的项目行取得，使每个项目拥有无重复、无跳序的单调事件流。

客户端使用 `projectId + seq` 去重。REST Snapshot 返回当前状态、当前 `lastEventSeq` 与近期事件窗口。Socket.IO 重连按客户端最后收到的序号请求后续事件；UI 从 Snapshot 与有序事件投影，不维护第二份状态真源。

工作流租约包含 owner、heartbeat、expiry 与单调 fencing token。租约获取、续期、释放和受 fence 约束的写入都在数据库事务内执行。旧 owner 即使在过期后恢复，也不能继续修改工作流或任务状态。

平台只能通过命名 `dsh` profile 启动。M4.1 从 Web 模板创建 Future Cup profile，并增加 Future Cup bundle；Fastify、Socket.IO、PostgreSQL 与平台 UI 都是插件贡献，不新增独立 Node 入口。

HQ 源码继续采用 PolyForm Noncommercial License 1.0.0，保留许可证与 `Required Notice`，当前本地模拟只能作为非权威设计参考。只有 M4.3 完成许可证复核与 Socket.IO 投影后，HQ 才接入真实事件。

### M4.0 已验证决策

- PostgreSQL 17.11 与 Prisma 7.10.1、`@prisma/adapter-pg` 通过 Prisma CLI 应用了真实迁移。
- 两个并发 Serializable 写入者产生项目事件序号 `1, 2`，对应 Outbox 行完整且无重复。
- 活跃租约期间第二个竞争者失败；租约过期后，两个独立 Node 进程竞争且恰好一个成功获取。
- 旧 fencing token 写入 `0` 行；当前 token 写入 `1` 行。
- 外键拒绝与事务回滚均符合实验要求。
- 真实 Harness Session 在 run 完成前投递 22 个 `onNotification` 事件，其中包含 `tool/call` 与 `tool/result`。
- `dsh --profile future-cup-platform --from-default-profile web --dump-config` 通过受支持启动器创建并组合了自定义 profile。
- HQ 在 1920×1080 下渲染原生 WebGL 场景。源码明确标注本地模拟，且没有 fetch 或 Socket.IO 集成。

### M4.1 实现结果

- SQLite schema v4 与仓库内 Prisma 迁移为 DAG revision、Journal、调度、执行、执行事件、验证、修复、工作流状态、项目事件、Outbox 与租约实现同一 `OrchestrationStore` 约定。
- 任务更新匹配前一 revision。项目事件与 Outbox 行在同一 Serializable 事务中按项目级序号提交。
- Outbox claim 包含 owner、token 与 expiry。SQLite 排除活跃 claim，PostgreSQL 使用 `FOR UPDATE SKIP LOCKED`，过期 claim 可重新投递并由客户端去重。
- Fastify 提供项目快照以及任务、调度、执行事件、验证、修复、工作流、启动与取消路由。Socket.IO 发送 `sync.snapshot` 与已提交的 `project.event`，并拒绝非法游标。
- PostgreSQL E2E 通过存储读写、并发事件排序、Outbox claim、重连游标与跨进程租约 fencing。真实 `dsh` Future Cup profile 完成组合并提供 API。
- 具体运行启动器仍是 M4.2 的服务边界。未挂载 `ctx.futureCupRunLauncher` 时，运行路由返回 503，而不是模拟执行。

### M4.2 实现结果

- SQLite schema v5 与第二个 PostgreSQL migration 新增 `project_runs`、私有 workspace 与 preview 路径、终态失败详情，并限制每个项目只有一个活跃运行。
- `FutureCupRunLauncher` 拥有 workflow lease 获取、心跳、真实 Harness 团队启动、通过 runtime 关闭实现取消、遗留运行回收与终态结算。服务关闭会等待启动中的运行再关闭活跃团队。
- 任务完成与执行结算在同一事务中提交。任务、执行、验证、修复、工作流与运行产品事件都在领域写入所在的存储事务中追加。
- 启动器写入携带 `ownerId + fencingToken`，每个存储事务都会拒绝过期或非当前 owner 的写入。结算在短暂重试期间保持 heartbeat，在响应歧义后对账已终态行，并以显式 pending 与 timeout 失败限制 cancel/close 的等待。
- Fastify 提供同源管理 SPA、受控验证截图、交付摘要与生成工程生产预览。公共投影移除绝对路径，并把 fencing token 序列化为字符串。
- 项目级 Agent 指标从 `RUNNING` 执行记录计算负载，从持久化执行结果计算成功率；权威事件游标推进时，React 应用会重新加载该投影。
- React 管理应用在桌面、平板与移动布局中提供项目控制、Agent 状态、React Flow DAG、调度证据、验证截图、Self-Loop Diff、实时事件与交付预览。
- 生成的 Vite 构建使用相对资源基址，使同一生产产物既可用于独立验证器，也可在 `/preview/:projectId/` 下预览。

## 考虑过的替代方案

**立即用 PostgreSQL 替换 SQLite。** 不予采纳，因为 M2/M3 的确定性测试依赖当前快速内存 SQLite 适配器，迁移应保持语义，而不是重写语义。

**每次数据库写入后直接广播。** 不予采纳，因为进程在提交与广播之间失败会丢失实时事件。事务性 Outbox 把持久事实与投递义务放在同一提交中。

**使用全局数据库序号作为客户端游标。** 不予采纳，因为无关项目会在单个项目流中产生空洞，使 Snapshot 续传更难推理。每个项目拥有自己的单调序号。

**只使用 owner 与 expiry 的租约。** 不予采纳，因为过期 Worker 恢复后可能覆盖新 Worker 的状态。每次写库都必须用 fencing token 与当前租约比对。

**把 Fastify 作为独立 Node 应用运行。** 不予采纳，因为仓库启动规则要求受支持应用通过 profile 启动，也需要统一的组合、兼容、生命周期与关闭模型。

**把 HQ 直接放在根 MIT 许可证下。** 不予采纳，因为 PolyForm Noncommercial 条款与必需版权声明必须随每一份分发副本保留。

**在视觉整合完成前保留 HQ 模拟数据。** 不予采纳，因为把模拟活动展示为产品执行会使平台证据失效。模拟只可作为清晰标注的独立设计参考。

## 验收标准

- M4.0 证据证明 PostgreSQL 迁移、事务事件序号、Outbox 持久化、重连查询、租约互斥、fencing 与回滚。
- M4.1 实现共享持久化约定，并让同一组行为测试同时通过 SQLite 与 PostgreSQL。
- M4.1 提供 Snapshot 与 `afterSeq` 重放约定，只广播已提交 Outbox 行。
- 所有产品事件都经过共享 Zod 判别联合校验。
- Future Cup bundle 通过 `dsh` 启动，并拥有 Fastify、Socket.IO、PostgreSQL 与平台 UI 生命周期。
- HQ 整合保留 PolyForm 许可证、必需声明与非商业边界；不得把模拟活动作为执行证据。

## 风险

- 竞赛使用必须保持非商业，或另行取得授权。本工程记录不构成法律意见。
- 远程验证主机内存约 2 GiB；PostgreSQL 测试必须使用有界容器并完成清理。
- Prisma 7 使用 Driver Adapter 与生成客户端；M4.1 必须固定兼容版本，避免跨包混用生成客户端。
- SDK 通知方法是 wire method，不是最终产品事件名。M4.1 需要显式投影、稳定映射与忽略事件策略。
- 长时间 Socket.IO 投递需要 Outbox 轮询、确认、保留与积压监控，不能假设一次进程内广播永远成功。
- HQ 使用远程 Google Fonts 与本地模拟数据；离线打包和真实事件替换属于 M4.3。
