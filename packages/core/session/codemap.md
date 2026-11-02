# packages/core/session/

## Responsibility
Durable session management, append-only event log, and replayable execution state.

## Design
Monotonic Event Sourcing pattern with schema validation and snapshot projections.

## Flow
Event creation -> Monotonic validation -> Append to SQLite/JSONL store -> Notify subscribers.

## Integration
Provides SessionService interface used by agents, CLI, and Web platforms.
