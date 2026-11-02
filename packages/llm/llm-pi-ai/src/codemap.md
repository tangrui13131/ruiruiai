# packages/llm/llm-pi-ai/src/

## Responsibility
Source implementation of Pi-AI/DeepSeek provider, streaming parser, and config.

## Design
Typed Cordis plugin implementing ModelProvider service with SSE response parsing.

## Flow
Stream response -> Parse SSE data lines -> Yield tool_calls and text deltas -> Emit usage metrics.

## Integration
Registers under ctx.llm and satisfies Cordis model invocation contracts.
