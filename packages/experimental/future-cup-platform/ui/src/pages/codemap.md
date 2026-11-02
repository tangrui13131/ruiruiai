# packages/experimental/future-cup-platform/ui/src/pages/

## Responsibility
Top-level view containers corresponding to platform routes.

## Design
Composite pages: ProjectOverview, DagView, Strategy, VerificationReport, SelfHealing, Deliverables, TeamManagement.

## Flow
URL route changes -> React Router mounts page -> Fetches project data -> Subscribes to live events.

## Integration
Configured in routes.tsx and rendered inside AppLayout.
