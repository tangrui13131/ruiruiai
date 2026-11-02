# packages/experimental/future-cup-orchestration/src/

## Responsibility
Core implementation files for DAG scheduling, agent team coordination, and repair.

## Design
Includes DagEngine, AgentRegistry, TeamOrchestrator, AdaptiveRepairService, and BrowserVerifier.

## Flow
User requirement submitted -> dag-engine builds task graph -> agents execute concurrently -> verifiers validate outputs -> self-healer triggers on failures.

## Integration
Interacts with SQLite database (sqlite.ts, repository.ts) and emits product events.
