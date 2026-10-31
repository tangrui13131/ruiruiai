---
description: "面向 Future Cup 前端平台的持久 DAG、可解释调度、独立浏览器验证与有界修复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-future-cup-orchestration

[English](README.md) | 中文

## 概述

通过可解释调度和真实 DeepSeek Harness Agent 团队执行持久化的前端工程 DAG。本包负责任务修订、Journal 回放、调度决策、执行证据、结构化 Agent 输出、受限文件落盘、独立静态/构建/浏览器验证，以及有界 Repair Agent 重试。`OrchestrationStore` 约定同时接受本包的 SQLite 适配器与 `future-cup-platform` 的 PostgreSQL 适配器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

需要 Future Cup M3 原型，或者需要持久任务 DAG、浏览器验证和有界自愈闭环测试时使用本包。

### 创建真实团队

创建一个 SQLite 仓库、七个默认 Agent profile，以及每个 profile 对应的真实 Harness invoker。Profile 包含 `Planner`、`UI Designer`、`Tester`、`Frontend Agent A`、`Frontend Agent B`、`Integration` 与 `Repair Agent`。两个 Frontend 实例具有相同能力与容量，用于并行任务负载分流。

```ts
import {
  createHarnessAgentTeam,
  defaultAgentProfiles,
  OrchestrationRepository,
  TeamOrchestrator,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'

const repository = new OrchestrationRepository('./orchestration.sqlite')
const profiles = defaultAgentProfiles()
const invokers = createHarnessAgentTeam(profiles, {
  workspace: './generated-app',
  homeRoot: './agent-homes',
})
const team = new TeamOrchestrator({
  repository,
  invokers,
  profiles,
  workspace: './generated-app',
  verification: {
    buildTimeoutMs: 600_000,
    browserTimeoutMs: 60_000,
    screenshotDir: './verification-screenshots',
  },
  selfLoop: {
    maxRepairRounds: 3,
    repairTimeoutMs: 600_000,
  },
})
const result = await team.run('Build a dashboard with a users page')
await team.close()
repository.close()
```

### DAG 状态

任务使用 `PENDING`、`READY`、`RUNNING`、`COMPLETED`、`FAILED`、`BLOCKED` 与 `CANCELLED`。创建和恢复都会拒绝环及缺失依赖。依赖完成会解锁下游任务；依赖失败或取消会阻断所有未完成下游。

### 持久记录

SQLite schema 包含项目、任务依赖、Journal、调度、执行、验证、修复、工作流、产品事件、Outbox 与工作流租约记录。每次任务变更都匹配前一 revision，并在同一事务中追加 Journal。`DagEngine.resume()` 重放 Journal，并拒绝与当前任务行不一致的状态。Schema v1 与 v2 数据库原地迁移到 v4，不删除已有验证证据。

### 调度

候选使用以下显式公式评分：

```text
capabilityMatch * capabilityWeight
+ historicalSuccessRate * successWeight
+ availability * availabilityWeight
+ priorityRatio * priorityWeight
- loadRatio * loadPenalty
```

权重是经过校验的配置。决策记录所有候选、资格、拒绝原因、得分明细、选中 Agent 与重试重分配原因。同分时优先较低负载，再按稳定 Agent id 排序。

### Agent 权限与输出

每个角色运行在独立 Harness runtime 和 Session 中，并应用 `artifact-only` profile patch。Bash 与 PowerShell 被禁用；文件系统工具只能读取，不能写入或编辑。Agent 返回由 Zod 校验的 JSON；编排器只写入任务声明范围内的路径。

UI Designer 返回设计 token，而不是大型样式表。本包根据 token 生成确定性的共享 CSS 文件。

### 验证与有界修复

Verifier 检查必需工程文件、要求使用 `HashRouter` 而非 `BrowserRouter`、安装依赖、运行 `tsc --noEmit`、创建 Vite 生产构建、启动 loopback 预览服务，并让 Playwright 在桌面与移动宽度下驱动 Chromium。只有全部预期路由渲染出非空内容、必需文本与导航交互成功，并且浏览器没有 `pageerror`、`console.error`、Ant Design 弃用告警、失败请求或 HTTP 4xx/5xx 响应时，状态才能为 PASS。

全部 finding 会规范化为确定性的 SHA-256 `failureSignature`。Self-loop 按显式配置允许 Repair Agent 轮次，每次修复后运行完整验证，保存真实源码 Diff 与修复前后状态；重复签名、超时、验证环境不完整或轮次耗尽时以 `ESCALATED` 终止。每次 Repair 调用使用独立 Harness Session。

### 实时产品事件

`product-events.ts` 定义持久事件、REST Snapshot 与 Socket.IO 投递共用的 Zod 约定。每个事件包含 `projectId`、项目内正数 `seq`、`occurredAt`、`type` 与 JSON payload。只有事件所属语义需要时才要求 `taskId` 或 `agentId`。客户端使用 `projectId + afterSeq` 续传，并以 `projectId + seq` 作为去重身份。

M4.0 门禁已用真实 PostgreSQL 序号与 TypeScript SDK 通知流验证该信封。`future-cup-platform` 现在拥有 PostgreSQL 存储、事务性 Outbox Dispatcher、Fastify 快照与 Socket.IO 重放。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 职责 |
|---|---|
| `src/sqlite.ts` | 带版本的 SQLite schema 与连接配置 |
| `src/repository.ts` | 持久任务、调度、执行、验证、修复与工作流记录 |
| `src/dag-engine.ts` | 环校验、就绪、状态转换、阻断、重新排队、Journal 回放与恢复 |
| `src/scheduler.ts` | 能力匹配、加权评分、负载均衡与重分配 |
| `src/agent-contracts.ts` | 结构化调用与 JSON 输出校验 |
| `src/harness-agents.ts` | 真实 TypeScript SDK Agent 适配器与只读 profile |
| `src/team-orchestrator.ts` | Planner、角色执行、Frontend 并行调用、Integration 与 Self-loop 组合 |
| `src/build-verifier.ts` | 独立依赖、TypeScript 与 Vite 构建检查 |
| `src/browser-verifier.ts` | Playwright 路由、交互、控制台、页面错误与网络验证 |
| `src/preview-server.ts` | 原子分配端口的自有 loopback 预览服务与静默关闭 |
| `src/failure-signature.ts` | 诊断规范化与稳定的重复失败哈希 |
| `src/self-healer.ts` | 有界修复循环、超时处理、重复失败熔断与人工升级 |
| `src/workspace-diff.ts` | 源码快照与真实统一 Diff 生成 |
| `src/product-events.ts` | Zod 产品事件约定与重连游标 |

## Model Experience

### Role prompts

#### What the model sees

每个 Agent 接收 `src/prompts.ts` 中的角色说明、由任务 Zod 校验器生成的 JSON Schema，以及完整结构化任务输入。Planner 查看用户需求；UI Designer 查看页面；Tester 查看页面与设计输出；每个 Frontend Agent 查看一个页面、对应 Tester 断言与设计输出；Integration 查看所有页面输出、验证断言与设计证据；Repair 查看结构化失败报告、受影响源码与历史修复摘要。

#### Token effect

Planner 与角色提示词包含任务输入和生成的 JSON Schema。Agent 默认输出上限为 32,000 token。UI Designer 返回紧凑 token；每个 Frontend 任务最多三个文件，每个 Integration 输出最多八个文件，每个 Repair 输出最多八个源码文件。

#### KV Cache effect

当角色、生成的 schema 和任务输入不变时，角色提示词保持稳定。不同任务和重试 Session 会自然从独立请求历史开始。

## Known Limitations and Deferred Work

- **实验性包**：M3 孵化期间公共 API 可能变化。
- **两个存储适配器**：SQLite 继续作为确定性测试适配器；`future-cup-platform` 通过 Prisma 提供 PostgreSQL。
- **固定进程内团队**：M3 团队由配置驱动，但不是通用 Agent 市场。
- **租约获取由启动器负责**：存储提供工作流租约与 revision 守卫；`future-cup-platform` 为每个项目运行获取、续期并校验 fencing token。
- **Playwright 运行时**：浏览器验证要求安装匹配的 Chromium 构建；浏览器不可用时产生 `INCOMPLETE`，不能产生 `PASS`。
- **不修复生成要求**：Repair 只能修改生成的 `src/` 文件；平台自有 scaffold 文件失败时进入人工升级，不能静默改写生成器。
- **Agent 输出预算**：大型页面需要显式模型输出配置或进一步任务拆解。

<a id="dev-note"></a>
### 开发备注

M3 对任务 Agent 使用 32,000 token 的结构化输出预算，并默认关闭 reasoning。浏览器验证与有界修复已接入正常 `TeamOrchestrator.run()` 路径。M4 负责 PostgreSQL、实时事件以及管理界面与 HQ 集成。
