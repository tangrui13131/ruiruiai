# apps/

## Responsibility
Application entry points and deployment executables for the DeepSeek Harness ecosystem.

## Design
Container for standalone CLI and runtime executables that compose package plugins through Cordis profiles.

## Flow
CLI invocation -> Profile resolution -> Cordis plugin container boot -> Service execution.

## Integration
Consumes packages/boot, packages/bundle, and packages/experimental.
