# 仓库健康分

[English](repo-health.md) | 中文

每次提交都必须让仓库健康分不低于此处记录的基线。基线为 **83/100**（2026-11-25）；只有在有意改变基线的提交中，经用户批准并写明理由，才能修改它。

## 评分维度

| 维度 | 权重 | 得分条件 |
|---|---:|---|
| 代码与构建健康 | 30 | `pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 与 `pnpm run check:web` 通过 |
| 本地测试健康 | 25 | 本机全量单元测试通过；Linux 验证的 `test:snapshot` 与 `test:expected` 没有新增失败 |
| 本地检查完整性 | 15 | 钩子、`scripts/run-gates.ts`、`package.json` 检查与 Makefile 目标保持完整；不得为了让分数上升而跳过、削弱或排除任何检查 |
| 远程保障 | 20 | 拉取请求 CI 与分支保护负责运行检查；本 fork 两者皆无，因此该维度上限为 6 |
| 仓库整洁与可回滚 | 10 | 工作区干净、提交语义清晰、文档链接可解析、翻译 sidecar 同步、限制与回滚路径有记录 |

## 健康底线

每次提交前运行下面的底线检查，合并到 `main` 或发布前运行完整底线：

```sh
pnpm run typecheck
pnpm run lint
pnpm run check:web
pnpm test
pnpm run build
```

对每个改动区域运行对应的聚焦测试；当文档、Agent Note 或翻译 sidecar 发生变化时，运行 `pnpm exec tsx scripts/run-gates.ts doc-sync`。

## 评分与执行

- 依据命令输出和仓库状态计算分数，而不是依据意图；提交前打印五个维度的分数及其证据。
- 分数低于基线的提交必须拒绝。修复回归、拆分提交，或取得用户明确批准并在同一提交中更新基线。
- 绝不允许通过删除、跳过、削弱或排除测试、类型检查、lint 规则、覆盖率阈值或翻译检查来抬高分数。
- 在提交信息或拉取请求描述中记录运行过的命令及其结果。
- 健康检查前若工作区不干净，停下来询问；不要把无关改动混入健康提交。

## 平台限制

`test:snapshot` 与 `test:expected` 仅在 Linux 上验证；它们在 Windows 上的失败记录在 [CI_MIGRATION_NOTES.md](../CI_MIGRATION_NOTES.md) 中，本身不会降低分数，但不得在 Linux 上出现回归。本 fork 没有拉取请求 CI 与分支保护，因此本地底线是唯一的合并信号，远程保障维度在恢复 CI 前保持为 6。

## 当前基线

83/100：代码 29、测试 23、检查 15、远程 6、整洁 10。要达到 90 分：推送本地提交、为 typecheck、lint 与测试增加一个最小的 `ubuntu-latest` CI，并完成 snapshot 与 expected 套件的 Linux 验证。
