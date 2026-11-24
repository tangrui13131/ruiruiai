# `dsh-desktop-runtime-closure`

English | [中文](README.zh.md)

Manifest-only workspace package that names every first-party package the desktop shell ships. `pnpm deploy --filter dsh-desktop-runtime-closure` produces the hoisted production closure under `apps/desktop/runtime`; the package has no code and no scripts.

The dependency list starts from [`python/sdk-runtime/package.json`](../../python/sdk-runtime/package.json) and adds the Future Cup platform and orchestration packages. The closure manifest exists so the deploy carries every peer dependency explicitly; a bare `pnpm deploy` of the CLI omits workspace peers that the runtime needs.

Regenerate after the Python runtime closure changes:

```sh
node -e "const fs=require('fs');const p=require('./python/sdk-runtime/package.json');const d={...p.dependencies,'@deepseek-ai/dsh-experimental-future-cup-platform':'workspace:*','@deepseek-ai/dsh-experimental-future-cup-orchestration':'workspace:*'};const sorted=Object.fromEntries(Object.entries(d).sort(([a],[b])=>a.localeCompare(b)));fs.writeFileSync('apps/desktop-runtime/package.json',JSON.stringify({name:'dsh-desktop-runtime-closure',private:true,version:'0.0.0',description:'Production runtime closure for the Future Cup desktop shell',license:'MIT',dependencies:sorted},null,2)+'\n')"
```
