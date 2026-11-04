---
kind: upgrade-guide
description: "Future Cup 项目可以创建不可变的升级后继项目，并继承冻结团队、项目记忆与已验证源码快照。"
---
# 创建 Future Cup 项目后继版本

[English](guide.md) | 中文

## 变更

`POST /api/v1/projects/:projectId/derivations` 从最新运行状态为 `PASSED` 的项目创建并启动后继项目。后继项目记录 `sourceProjectId`、`sourceProjectName`、`sourceRunId`、`derivationMode` 与可选 `changeRequest`。

来源项目及其证据保持不变。后继项目复制来源项目的冻结团队快照和项目记忆。`UPGRADE` 在 Agent 执行前恢复已通过运行的不可变交付快照；`REGENERATE` 从空工作区开始。已通过运行现在会在工作区旁保存安全的交付快照。

SQLite schema v9 与 `20261104090000_add_project_derivation` PostgreSQL migration 新增谱系字段与索引。已有项目继续使用当前行为。

## 迁移

1. 应用 PostgreSQL migration，或让 SQLite 通过正常 schema migration 打开已有数据库。
2. 保持原有工作区根目录可读可写。旧版已通过项目没有交付快照时，升级派生会从来源运行工作区创建快照。
3. 来源项目必须使用已冻结的团队；派生会复制完全相同的快照，不会重新解析团队。
4. 来源存在活跃运行、最新运行不是 `PASSED`、缺少工作区或安全快照、或缺少冻结团队时，接口返回 `409`。
5. 在后继项目创建并启动新运行前，不要删除来源项目。
