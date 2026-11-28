# `dsh-desktop-runtime-closure`

[English](README.md) | 中文

仅含清单的工作区包，列出桌面外壳随附的每一个一方包。`pnpm deploy --filter dsh-desktop-runtime-closure` 会在 `apps/desktop/runtime` 下生成扁平化的生产闭包；该包没有代码，也没有脚本。

依赖列表以 [`python/sdk-runtime/package.json`](../../python/sdk-runtime/package.json) 为起点，再加上 Future Cup 平台与编排包。闭包清单的存在是为了让部署显式携带每一个 peer 依赖；直接对 CLI 执行 `pnpm deploy` 会漏掉运行时所需的 workspace peer。

Python 运行时闭包变化后重新生成：

```sh
node -e "const fs=require('fs');const p=require('./python/sdk-runtime/package.json');const d={...p.dependencies,'@deepseek-ai/dsh-experimental-future-cup-platform':'workspace:*','@deepseek-ai/dsh-experimental-future-cup-orchestration':'workspace:*'};const sorted=Object.fromEntries(Object.entries(d).sort(([a],[b])=>a.localeCompare(b)));fs.writeFileSync('apps/desktop-runtime/package.json',JSON.stringify({name:'dsh-desktop-runtime-closure',private:true,version:'0.0.0',description:'Production runtime closure for the Future Cup desktop shell',license:'MIT',dependencies:sorted},null,2)+'\n')"
```
