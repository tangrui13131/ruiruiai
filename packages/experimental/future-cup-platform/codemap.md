# packages/experimental/future-cup-platform/

## Responsibility
Full-stack Web and API platform for the Future Cup Multi-Agent Frontend Engineering Platform.

## Design
Cordis service plugin hosting Fastify/HTTP API, Socket.IO realtime server, and serving built UI.

## Flow
HTTP/WS request from browser -> Fastify routes / Socket.IO events -> Orchestration Service -> Push real-time DAG updates.

## Integration
Mounted as default web profile in apps/cli and consumed by browser clients on port 3090.
