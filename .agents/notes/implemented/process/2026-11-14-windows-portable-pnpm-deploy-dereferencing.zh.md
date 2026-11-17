# Agent Note: Windows 便携打包与 pnpm deploy 符号链接实体化

Status: implemented

[English](2026-11-14-windows-portable-pnpm-deploy-dereferencing.md) | 中文

## 问题

使用 `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod --config.node-linker=hoisted` 将 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-experimental-future-cup-platform` 导出为可迁移的 Windows 便携目录时，会遗漏部分工作区传递 `peerDependencies`（例如 `@deepseek-ai/dsh-host-plugin-inventory`、`@deepseek-ai/dsh-scope`、`@deepseek-ai/dsh-attachment`），并且会在 `app/node_modules/@deepseek-ai/schemastery` 等位置生成指向原代码仓库 `vendor/schemastery` 的 Windows NTFS 目录联接（Junction）。在打包本机上做冒烟测试时，Node.js 会顺着联接读回源码仓库从而掩盖问题；一旦用 `tar.exe` 打成 `.zip` 并解压到其他盘符或机器，联接失效就会导致启动报 `ERR_MODULE_NOT_FOUND`。

## 决策

所有面向 `@deepseek-ai/dsh` 与 `future-cup-platform` 的 Windows 可迁移便携包，在归档前都必须生成完全自包含、零符号链接且零目录联接的实体目录。

在执行 `pnpm deploy --legacy --prod --config.node-linker=hoisted` 之后，打包流程将缺失的 Windows 兼容工作区包（`packages/*/*`、`vendor/*` 与 `native/system/packages/win32-x64`）以解引用实体拷贝的方式补全到扁平 `app/node_modules/<pkgName>`（排除 `node_modules`、`src`、`tests`、`ui` 与 `.tsbuildinfo`），将 `app/node_modules` 下已有的任何 `ReparsePoint` 目录联接（包括 `@deepseek-ai/schemastery`）替换为 `package.json` 与 `lib/` 的真实文件副本，并在打包完成前递归校验 `app` 与 `runtime` 目录下的符号链接与目录联接数量必须为 `0`。

Windows 启动脚本（`start.ps1`）使用 `app/lib/bin.js web --no-open` 启动服务，避免 `dsh web` 与 `future-cup-platform` 自身重复打开浏览器标签而改由启动器在服务就绪后打开单一页面；运行时 SQLite 数据、生成工作区与 `.env` 统一隔离在打包前排除的本地 `data/` 目录中，并在未配置密钥时通过 Windows Forms 图形弹窗引导输入 `DEEPSEEK_API_KEY`。

## 后果

- 打包产物解压到任意盘符或其他 Windows 电脑后，所有工作区与 `vendor` ESM 模块均可独立解析，不再依赖原代码仓库路径。
- 打包验收流程必须包含零 `ReparsePoint` 校验，且分发压缩包必须排除 `data/` 目录以防止本地测试 API Key 泄漏。
- 后续向 `apps/cli` 或 `future-cup-platform` 新增工作区或 `vendor` 依赖时，只要执行缺失包补全与联接实体化步骤即可保持可迁移性。

## 考虑过的替代方案

- **保留 `pnpm deploy` 默认隔离存储而不使用扁平 `hoisted` 模式。** 已否决，因为 Cordis 动态插件加载与工作区传递 `peerDependencies` 的 ESM 解析在隔离目录下会缺失包，必须扁平落盘到 `app/node_modules`。
- **保留 `--config.link-workspace-packages=true` 生成的目录联接并依赖压缩工具参数解引用。** 已否决，因为 Windows 下不同压缩工具（`tar.exe`、系统资源管理器压缩、7-Zip）对 NTFS 目录联接的处理不一致；在暂存目录阶段直接落地为真实文件才能确保任意打包和解压工具都能正常工作。
- **使用 Node.js 单文件可执行程序（SEA）打包。** 已否决，因为 Cordis 插件发现需要扫描 `node_modules` 包目录、`future-cup-platform` 需要托管 `lib/web/**` 静态资源，且运行时依赖 `native/system`、`koffi`、`node-pty` 等原生 `.node` 扩展。
