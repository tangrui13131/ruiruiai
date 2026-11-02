# packages/experimental/future-cup-platform/ui/src/state/

## Responsibility
Global state stores and persistence hooks for user sessions.

## Design
Lightweight reactive state management for active project selection, theme, and cached runs.

## Flow
User action -> Update state store -> Re-render subscribed components.

## Integration
Used across navigation sidebar, header, and page views.
