# packages/experimental/future-cup-platform/

## Responsibility
Full-stack Web and API platform for the Future Cup Multi-Agent Frontend Engineering Platform.

## Design
Cordis service plugin hosting Fastify/HTTP API, official MCP Streamable HTTP transport, Socket.IO realtime server, and serving built UI.

## Flow
HTTP/WS request from browser -> Fastify routes / Socket.IO events -> Orchestration Service -> Push real-time DAG updates.

External MCP client -> `/api/v1/mcp` -> official SDK transport -> MCP tools, resources, and prompts -> Orchestration Service; browser discovery uses `/api/v1/mcp/info`.

## Integration
Mounted as default web profile in apps/cli, consumed by browser clients on port 3090, and exposed to loopback MCP clients at `/api/v1/mcp`.
