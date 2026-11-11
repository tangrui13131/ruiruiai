# packages/experimental/future-cup-platform/ui/

## Responsibility
Single Page Application (SPA) frontend for Future Cup Multi-Agent Platform.

## Design
React 18 + TypeScript + Ant Design 6 + XyFlow DAG canvas built with Vite.

## Flow
Browser requests / -> Vite serves index.html -> React mounts -> Connects to /api, /socket.io, and MCP discovery at /api/v1/mcp/info.

## Integration
Communicates with backend at http://127.0.0.1:3090 via REST, WebSockets, and MCP connection guidance.
