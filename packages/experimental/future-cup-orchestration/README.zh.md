---
description: "面向 Future Cup 前端平台的持久 DAG、可解释调度与真实 Harness Agent 团队编排。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-future-cup-orchestration

[English](README.md) | 中文

## Summary

通过可解释调度和真实 DeepSeek Harness Agent 团队执行持久化的前端工程 DAG。本包负责任务修订、Journal 回放、调度决策、执行证据、结构化 Agent 输出、受限文件落盘以及独立的 TypeScript/Vite 验证。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

需要 Future Cup M2 原型，或者需要带真实 Harness Session 的持久任务 DAG 测试时使用本包。

### 创建真实团队

创建一个 SQLite 仓库、五个默认 Agent profile，以及每个 profile 对应的真实 Harness invoker。Profile 包含 `Planner`、`UI Designer`、`Frontend Agent A`、`Frontend Agent B` 与 `Integration`。两个 Frontend 实例具有相同能力与容量，用于并行任务负载分流。

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
const team = new TeamOrchestrator({ repository, invokers, profiles, workspace: './generated-app' })
const result = await team.run('Build a dashboard with a users page')
await team.close()
repository.close()
```

### DAG 状态

任务使用 `PENDING`、`READY`、`RUNNING`、`COMPLETED`、`FAILED`、`BLOCKED` 与 `CANCELLED`。创建和恢复都会拒绝环及缺失依赖。依赖完成会解锁下游任务；依赖失败或取消会阻断所有未完成下游。

### 持久记录

SQLite schema 包含 `projects`、`tasks`、`task_dependencies`、`task_journal`、`scheduler_decisions`、`executions`、`execution_events` 与 `verification_reports`。每次任务变更都在同一事务中递增 revision 并追加 Journal。`DagEngine.resume()` 重放 Journal，并拒绝与当前任务行不一致的状态。

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

-----

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 职责 |
|---|---|
| `src/sqlite.ts` | 带版本的 SQLite schema 与连接配置 |
| `src/repository.ts` | 持久任务、调度、执行、事件与验证记录 |
| `src/dag-engine.ts` | 环校验、就绪、状态转换、阻断、重新排队、Journal 回放与恢复 |
| `src/scheduler.ts` | 能力匹配、加权评分、负载均衡与重分配 |
| `src/agent-contracts.ts` | 结构化调用与 JSON 输出校验 |
| `src/harness-agents.ts` | 真实 TypeScript SDK Agent 适配器与只读 profile |
| `src/team-orchestrator.ts` | Planner、角色执行、Frontend 并行调用、Integration 与构建验证 |
| `src/build-verifier.ts` | 独立 npm install 与 TypeScript/Vite 构建检查 |

## Model Experience

### Role prompts

#### What the model sees

每个 Agent 接收 `src/prompts.ts` 中的角色说明、由任务 Zod 校验器生成的 JSON Schema，以及完整结构化任务输入。Planner 查看用户需求；UI Designer 查看页面；每个 Frontend Agent 查看一个页面与设计输出；Integration 查看所有页面输出与设计证据。

#### Token effect

Planner 与角色提示词包含任务输入和生成的 JSON Schema。Agent 默认输出上限为 32,000 token。UI Designer 返回紧凑 token；每个 Frontend 任务最多三个文件，每个 Integration 输出最多八个文件。

#### KV Cache effect

当角色、生成的 schema 和任务输入不变时，角色提示词保持稳定。不同任务和重试 Session 会自然从独立请求历史开始。

## Known Limitations and Deferred Work

- **实验性包**：M2 孵化期间公共 API 可能变化。
- **SQLite 原型**：PostgreSQL 与 Prisma 集成仍属于 M4。
- **固定进程内团队**：M2 团队由配置驱动，但不是通用 Agent 市场。
- **没有跨进程调度租约**：预期一个进程在同一时间拥有一个项目 DAG。
- **单一动作验证器**：本里程碑验证安装、TypeScript 与 Vite 构建；浏览器验证和有界修复属于 M3。
- **Agent 输出预算**：大型页面需要显式模型输出配置或进一步任务拆解。

<a id="dev-note"></a>
### 开发说明

M2 对任务 Agent 使用 32,000 token 的结构化输出预算，并默认关闭 reasoning。M3 应使用基于证据的任务拆解替代固定输出上限，并在构建之外验证浏览器行为。
