# packages/core/agent/

## Responsibility
Agent abstraction, tool execution dispatch, and model invocation loop.

## Design
Stateful Agent instance running an iterative Thought-Action-Observation loop with guardrails.

## Flow
Agent.run(prompt) -> query model -> execute tool calls -> fold results into context -> check termination.

## Integration
Consumed by subagent orchestrators, session runners, and high-level workflows.
