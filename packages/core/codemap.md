# packages/core/

## Responsibility
Foundational agent runtime, session state machine, and lifecycle protocols.

## Design
Separation of concerns between agent execution loop (packages/core/agent) and event persistence (packages/core/session).

## Flow
Agent receives user prompt -> Loops with LLM and tool calls -> Emits monotonic events to Session.

## Integration
Used by all profile bundles and orchestration layers.
