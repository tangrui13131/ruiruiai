# packages/experimental/future-cup-platform/ui/src/realtime/

## Responsibility
Socket.IO event listeners and real-time event dispatcher.

## Design
Event bus pattern normalizing inbound socket messages into reactive UI updates.

## Flow
Inbound WS event -> Validate event payload -> Dispatch to active page state listener.

## Integration
Connected to backend Socket.IO gateway on port 3090.
