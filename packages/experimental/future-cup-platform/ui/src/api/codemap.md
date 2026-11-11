# packages/experimental/future-cup-platform/ui/src/api/

## Responsibility
Typed REST client, MCP discovery client, WebSocket connection manager, and contract interfaces.

## Design
Centralized client layer wrapping fetch and Socket.IO with typed request/response contracts.

## Flow
Pages call project and team APIs through fetch; AppShell calls api.getMcpServerInfo() -> `/api/v1/mcp/info` -> Return validated MCP tool, resource, and prompt descriptors.

## Integration
Consumes schemas and event contracts from future-cup-orchestration.
