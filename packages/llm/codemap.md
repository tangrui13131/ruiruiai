# packages/llm/

## Responsibility
Language model provider integrations, streaming protocols, and token management.

## Design
Adapter pattern decoupling agent reasoning loop from specific LLM vendor APIs.

## Flow
Agent request -> Model adapter formatting -> HTTP streaming API -> Normalized token stream.

## Integration
Supports DeepSeek, OpenAI-compatible APIs, and local mock servers.
