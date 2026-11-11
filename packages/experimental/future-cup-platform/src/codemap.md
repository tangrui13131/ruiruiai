# packages/experimental/future-cup-platform/src/

## Responsibility
Backend service and HTTP/WebSocket endpoints for Future Cup platform.

## Design
PlatformService Cordis plugin implementing REST controllers, project derivation and snapshots, official MCP SDK transport, WebSocket pub-sub, and static file middleware.

## Flow
Client connects via Socket.IO -> subscribes to project runs -> server forwards product events (dagNodeStatus, repairAttempt, etc.).

MCP client -> Streamable HTTP -> SDK protocol validation -> platform operations -> structured tool/resource results; browser clients read the descriptor from `/api/v1/mcp/info`.

## Integration
Bridges future-cup-orchestration with the web UI and external MCP clients.
