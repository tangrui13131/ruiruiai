# packages/experimental/future-cup-platform/src/

## Responsibility
Backend service and HTTP/WebSocket endpoints for Future Cup platform.

## Design
PlatformService Cordis plugin implementing REST controllers, project derivation and snapshots, official MCP SDK transport, WebSocket pub-sub, and static file middleware.

`run-launcher.ts` starts a real Harness team for a project, holds and renews the workflow lease, and settles the durable run. `project-derivation.ts` creates immutable successors that inherit the source team snapshot and project memory. `project-rerun.ts` clones a terminal project's requirement, frozen team, and memory into an independent project so it can start a fresh run.

## Flow
Client connects via Socket.IO -> subscribes to project runs -> server forwards product events (dagNodeStatus, repairAttempt, etc.).

MCP client -> Streamable HTTP -> SDK protocol validation -> platform operations -> structured tool/resource results; browser clients read the descriptor from `/api/v1/mcp/info`.

## Integration
Bridges future-cup-orchestration with the web UI and external MCP clients.

A project freezes the team version it starts with, so an Agent prompt change only reaches later projects after a new team version is published.
