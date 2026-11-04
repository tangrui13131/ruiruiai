# packages/experimental/future-cup-platform/src/

## Responsibility
Backend service and HTTP/WebSocket endpoints for Future Cup platform.

## Design
PlatformService Cordis plugin implementing REST controllers, project derivation and snapshots, WebSocket pub-sub, and static file middleware.

## Flow
Client connects via Socket.IO -> subscribes to project runs -> server forwards product events (dagNodeStatus, repairAttempt, etc.).

## Integration
Bridges future-cup-orchestration with the web UI.
