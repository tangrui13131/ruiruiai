# packages/core/session/src/

## Responsibility
Core implementation of durable sessions, event stream projection, and recovery.

## Design
Implements SessionEventMap, SessionStore, and fold projection hooks for state recovery.

## Flow
Session.append(event) -> writes to durable storage -> triggers onEvent handlers -> updates projection.

## Integration
Exposes Session and SessionManager services to the Cordis lifecycle.
