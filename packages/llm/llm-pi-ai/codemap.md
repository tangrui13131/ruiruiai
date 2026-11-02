# packages/llm/llm-pi-ai/

## Responsibility
Primary DeepSeek and Pi-AI model provider implementation.

## Design
Streaming HTTP client with automatic retry, key rotation, and rate-limit backoff.

## Flow
LlmService.complete() -> Build request payload with system prompt & tool specs -> Stream chunks -> Resolve final turn.

## Integration
Reads DEEPSEEK_API_KEY from environment or .env and serves model calls for all agents.
