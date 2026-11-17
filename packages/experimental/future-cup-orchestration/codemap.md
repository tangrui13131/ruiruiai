# packages/experimental/future-cup-orchestration/

## Responsibility
Future Cup multi-agent orchestration engine, DAG dependency resolution, and self-healing.

## Design
Modular architecture separating Agent Registry, DAG Engine, Adaptive Repair, and Verification.

The generated project is a fixed React 18 + TypeScript + Vite 6 + Ant Design 5 stack with HashRouter routing. `project-scaffold.ts` writes that scaffold for every run; Agents only supply page sources and shared application files, so the page count follows the requirement instead of a constant.

## Flow
Project Requirements -> Team Recommender -> DAG Plan -> Multi-Agent Execution -> Self-Healing -> Verification.

## Integration
Powers Future Cup Platform backend (future-cup-platform) and exports contracts to UI.

Stored Agent versions are immutable, so a prompt edited in `src/prompts.ts` never reaches a running Agent on its own. `scripts/sync-agent-prompts.ts` registers a new version carrying the current prompt text and publishes a team version that uses it, without touching existing projects.
