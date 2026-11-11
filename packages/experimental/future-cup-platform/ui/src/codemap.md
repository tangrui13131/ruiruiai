# packages/experimental/future-cup-platform/ui/src/

## Responsibility
Frontend source root containing application entry, routing, and shared state.

## Design
Component-based architecture organized into pages, shared components, hooks, and API clients.

## Flow
main.tsx -> App.tsx (Theme & Router) -> Page Components -> Real-time event subscription.

## Integration
Renders DAG nodes, agent status cards, execution metrics, logs, and the MCP access guide in the application shell.
