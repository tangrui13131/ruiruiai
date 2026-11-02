# packages/experimental/future-cup-platform/ui/src/routes/

## Responsibility
Application routing definitions and navigation layout hierarchy.

## Design
Declarative React Router configuration with layout shell and error boundaries.

## Flow
URL matching -> Resolves route component -> Injects route params (projectId, runId).

## Integration
Loaded by App.tsx.
