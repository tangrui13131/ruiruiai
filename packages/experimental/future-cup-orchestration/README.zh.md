---
description: "面向 Future Cup 前端平台的持久 DAG、可解释调度、独立浏览器验证与有界修复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-future-cup-orchestration

[English](README.md) | 中文

## 概述

通过可解释调度和真实 DeepSeek Harness Agent 团队执行持久化的前端工程 DAG。本包负责任务修订、Journal 回放、版本化 Agent Registry、冻结项目团队、结构化项目记忆、显式工作流控制、自适应修复策略、智能配队、调度决策、执行证据、结构化 Agent 输出、受限文件落盘、独立静态/构建/浏览器验证，以及有界 Repair Agent 重试。`OrchestrationStore` 约定同时接受本包的 SQLite 适配器与 `future-cup-platform` 的 PostgreSQL 适配器。

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

### Agent Registry 与工作流控制

`PersistentAgentRegistry` 将 Agent 定义、不可变版本、发布状态、团队编制、项目记忆和项目冻结绑定持久化到共享仓储。默认团队由 `createDefaultAgentTeam()` 生成七个受控定义，其中 Frontend 版本实例化两次；项目创建时必须保存完整成员快照，后续 Registry 修改不能改变已启动项目。

`WorkflowControlCoordinator` 将版本化控制图与执行快照写入仓储。固定控制图从独立验证开始，`PASS` 进入交付，`FAIL` 或 `INCOMPLETE` 进入 Repair 子工作流，Repair 完成返回验证；循环最多三轮，重复失败签名先切换未使用策略，再无替代策略时升级。每个节点、边选择、循环轮次和子工作流进入/退出都有持久 Journal，可从一个快照确定性恢复。

### 自适应修复与智能配队

`selectRepairStrategy()` 根据 finding 类别、目标路径、轮次和历史策略使用记录生成可解释候选评分。每项策略只声明提示词片段、有界上下文、既有工具要求与 `src/` 写入范围，复验固定为完整验证流水线。Self-loop 在 Repair 修改源码前保存策略决策，并在复验后关联真实 Repair 记录和下一轮动作。

`recommendAgentTeam()` 只使用已发布 Agent 版本和已发布团队模板。它从自然语言需求提取项目画像，最多产生三个结构化澄清问题，并校验能力覆盖、并发、工具、记忆与输入输出契约。`applyTeamAdjustment()` 只接受受控自然语言调整；`createAgentTeamVersionInputFromRecommendation()` 生成可保存的不可变团队版本。

### DAG 状态

任务使用 `PENDING`、`READY`、`RUNNING`、`COMPLETED`、`FAILED`、`BLOCKED` 与 `CANCELLED`。创建和恢复都会拒绝环及缺失依赖。依赖完成会解锁下游任务；依赖失败或取消会阻断所有未完成下游。

### 持久记录

SQLite schema 包含项目、任务依赖、Journal、调度、执行、验证、修复、策略决策、工作流、产品事件、Outbox、工作流租约、Agent Registry、团队绑定、项目记忆与工作流控制记录。每次任务变更都匹配前一 revision，并在同一事务中追加 Journal。`DagEngine.resume()` 重放 Journal，并拒绝与当前任务行不一致的状态。Schema v1-v6 数据库原地迁移到 v7，不删除已有验证证据。

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
| `src/adaptive-repair.ts` | 失败分类、策略目录、候选评分、重复签名切换与有界上下文选择 |
| `src/self-healer.ts` | 有界修复循环、策略持久化、超时处理与人工升级 |
| `src/workspace-diff.ts` | 源码快照与真实统一 Diff 生成 |
| `src/product-events.ts` | Zod 产品事件约定与重连游标 |
| `src/agent-registry.ts` | Agent 定义、不可变版本、团队校验与项目冻结 |
| `src/agent-registry-service.ts` | Registry 的持久化重放与项目 profile 投影 |
| `src/default-agent-team.ts` | 七个受控默认 Agent 定义与团队种子 |
| `src/team-recommender.ts` | 项目画像、澄清、完整团队推荐、受控调整与 Registry 转换 |
| `src/workflow-control.ts` | 版本化控制图、条件、循环、子工作流与恢复 |
| `src/workflow-control-coordinator.ts` | 控制快照与 Journal 的持久化协调 |

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
- **受控 Registry 团队**：默认团队可从持久 Registry 恢复并由小白配队入口推荐完整编制，但初赛仍不允许任意 Agent、任意工具或自由团队编辑器。
- **租约获取由启动器负责**：存储提供工作流租约与 revision 守卫；`future-cup-platform` 为每个项目运行获取、续期并校验 fencing token。
- **Playwright 运行时**：浏览器验证要求安装匹配的 Chromium 构建；浏览器不可用时产生 `INCOMPLETE`，不能产生 `PASS`。
- **不修复生成要求**：Repair 只能修改生成的 `src/` 文件；平台自有 scaffold 文件失败时进入人工升级，不能静默改写生成器。
- **Agent 输出预算**：大型页面需要显式模型输出配置或进一步任务拆解。

<a id="dev-note"></a>
### 开发备注

M3 对任务 Agent 使用 32,000 token 的结构化输出预算，并默认关闭 reasoning。M4 完成 PostgreSQL、实时事件、管理界面与 HQ；M5.1 和 M5.2 增加持久 Agent Registry、项目团队冻结、项目记忆和可恢复工作流控制；M5.3 增加自适应修复策略，M5.4 增加智能配队。修复执行仍由同一个 `SelfLoopController` 管理。
