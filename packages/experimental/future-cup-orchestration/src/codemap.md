# packages/experimental/future-cup-orchestration/src/

## Responsibility
Core implementation files for DAG scheduling, agent team coordination, verification, and repair.

## Design
Includes DagEngine, AgentRegistry, TeamOrchestrator, AdaptiveRepairService, BrowserVerifier, BuildVerifier, and BundleManifest.

`project-scaffold.ts` owns the deterministic React/Vite/Ant Design scaffold that every run starts from, and the scoped writer that keeps Agent file writes inside declared `src/` scopes. `prompts.ts` owns the role instructions every Agent runs with. `bundle-manifest.ts` compares the modules that reached the production bundle against the generated sources.

## Flow
User requirement submitted -> dag-engine builds task graph -> agents execute concurrently -> build verifier creates the Vite bundle -> bundle coverage check -> browser verifier validates routes -> self-healer triggers on failures.

## Integration
Interacts with SQLite database (sqlite.ts, repository.ts) and emits product events.
