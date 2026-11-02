# packages/core/agent/src/

## Responsibility
Implementation files for Agent, agent loop, tool dispatch, and runtime context.

## Design
Extensible plugin architecture registering agent factory services on the Cordis Context.

## Flow
Context resolves AgentService -> spawns Agent instance -> attaches tool registry -> executes turns.

## Integration
Imports from packages/core/session for event journaling and packages/llm for model completions.
