# packages/

## Responsibility
Monorepo workspaces containing all core libraries, plugins, protocols, and experimental features.

## Design
Fine-grained packages following Cordis plugin protocol with explicit service definitions and contracts.

## Flow
Plugins declare services, register effects via ctx.effect(), and communicate over typed events.

## Integration
Exported under @deepseek-ai/dsh-* namespace across core, llm, shell, and experimental groups.
