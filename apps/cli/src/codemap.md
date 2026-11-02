# apps/cli/src/

## Responsibility
Source implementation of the DSH command-line interface and profile loader.

## Design
Modular CLI command handlers with Cordis context lifecycle and signal handling (SIGINT/SIGTERM).

## Flow
bin.ts invokes parseCommandLine() -> resolves profile YAML -> runs ctx.start().

## Integration
Imports @deepseek-ai/dsh-app-boot and loads plugins defined in cordis.yml.
