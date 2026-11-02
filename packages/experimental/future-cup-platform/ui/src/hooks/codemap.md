# packages/experimental/future-cup-platform/ui/src/hooks/

## Responsibility
Custom React hooks for real-time data streaming, polling, and UI state.

## Design
Reusable stateful hooks abstracting WebSocket subscriptions and async fetch operations.

## Flow
useProjectRuns(id) -> Subscribes to Socket.IO events -> Updates local React state on run updates.

## Integration
Consumed across all top-level page components.
