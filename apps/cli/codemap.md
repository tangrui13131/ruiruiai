# apps/cli/

## Responsibility
Main command-line executable package for deepseek-harness.

## Design
Node CLI wrapper executing tsx/esm hooks, parsing arguments, and booting Cordis profiles.

## Flow
Process launch (bin.ts) -> Parse argv -> Load cordis.yml / profile -> Dispatch commands (web, headless, run).

## Integration
Entry point for users and daemon scripts (start.bat, pnpm start).
