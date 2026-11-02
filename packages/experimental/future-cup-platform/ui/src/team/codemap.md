# packages/experimental/future-cup-platform/ui/src/team/

## Responsibility
Agent team configuration, capability matching, and team editing UI.

## Design
Form controllers and visual cards for creating and editing multi-agent teams (M5.5).

## Flow
User edits team -> Validate agent roles and concurrency limits -> Submit to /api/teams -> Refresh project team binding.

## Integration
Used by TeamPage and project creation wizard.
