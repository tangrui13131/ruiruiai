# Future Cup 桌面外壳

[English](README.md) | 中文

把 Future Cup 平台作为 Windows 桌面应用运行的最小 Electron 外壳。外壳负责窗口、无边框标题覆盖层、API Key 对话框，以及随附 dsh host 的生命周期；平台本身保持不变。

## 布局

```
apps/desktop/
  src/main.ts        single instance, window, quit lifecycle
  src/host.ts        spawns `dsh web` under Electron Node mode
  src/preload.cts    frameless drag regions and caption theme bridge
  src/settings.ts    API-key encryption through the OS credential store
  renderer/          splash and first-run settings documents
  scripts/           runtime-closure preparation
```

## 开发

```sh
pnpm install
pnpm --filter @deepseek-ai/dsh-desktop-shell run prepare:runtime
pnpm --filter @deepseek-ai/dsh-desktop-shell run prepare:portable
pnpm --filter @deepseek-ai/dsh-desktop-shell run dev
```

`prepare:runtime` 部署 `dsh-desktop-runtime-closure`、物化工作区链接，并把 source map 与声明文件裁剪到 `apps/desktop/runtime/app`。开发期间可设置 `DSH_DESKTOP_CLOSURE` 使用另一个闭包。

`prepare:portable` 在 `apps/desktop/runtime/node` 放置一份便携式 Node.js 24 发行版，并在 `apps/desktop/runtime/playwright-browsers` 放置 Playwright Chromium 1255。host 会把随附的 Node 目录前置到 `PATH`，并设置 `PLAYWRIGHT_BROWSERS_PATH`，因此一台干净的 Windows 机器无需全局安装即可运行 `npm install`、Vite 构建和浏览器验证。

环境中的 `DEEPSEEK_API_KEY` 会跳过首次运行对话框。`DSH_DESKTOP_CAPTURE=<path>` 会把已加载窗口写成 PNG 后退出，便于做视觉检查。

## 打包

```sh
pnpm --filter @deepseek-ai/dsh-desktop-shell run package:win
```

NSIS 安装包生成在 `apps/desktop/release-final/`。运行时闭包放在 ASAR 归档之外的 `resources/runtime/app` 下，从而保持原生模块正常的文件系统布局。

## 便携盘

在 `Future Cup.exe` 旁边放一个空的 `portable.flag`；应用随后会把 `settings.json`、SQLite 数据库、运行记录和 dsh home 存放在可执行文件旁的 `userdata/` 下。整个 profile 随盘移动。

请保持盘符稳定。记录下来的运行路径是绝对路径，把 profile 移到另一个盘符或目录后，历史截图和预览将无法解析。

便携模式会把 API Key 以明文存进 `userdata/settings.json`，因为 Windows DPAPI 无法跨机器解密。请保护好该盘，出借前删除这个文件。

## 导入 Web 历史

从 Web 部署复制来的数据库记录的是 Web 运行根目录下的绝对截图、预览和工作区路径。artifact 服务器只提供自己运行根目录内的文件，因此这些历史条目会显示为空白图片位。关闭应用后，把产物复制到桌面端数据根目录并改写记录的路径：

```sh
node apps/desktop/scripts/import-history.mjs --dry-run
node apps/desktop/scripts/import-history.mjs
```

脚本会先备份数据库，再复制截图与工作区（不含 `node_modules` 和 `.git`），并改写 `project_runs.workspace_path`、`project_runs.preview_path` 以及 `verification_reports.report_json` 中的截图路径。便携安装需要传入自己的 profile：

```sh
node apps/desktop/scripts/import-history.mjs --target-data-root "G:\瑞睿AI\Future Cup\userdata\data"
```
