# packages/experimental/future-cup-platform/ui/src/api/

## Responsibility
Typed API client, WebSocket connection manager, and contract interfaces.

## Design
Centralized client layer wrapping fetch and Socket.IO with typed request/response contracts.

## Flow
Pages call api.getProjects(), api.createProject() -> fetch HTTP -> Return validated data models.

## Integration
Consumes schemas and event contracts from future-cup-orchestration.
