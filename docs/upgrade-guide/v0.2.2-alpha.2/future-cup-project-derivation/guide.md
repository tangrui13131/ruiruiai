---
kind: upgrade-guide
description: "Future Cup projects can create immutable upgrade successors with inherited frozen Teams, project memory, and verified source snapshots."
---
# Create Future Cup project successors

English | [中文](guide.zh.md)

## Change

`POST /api/v1/projects/:projectId/derivations` creates and starts a successor project from a project whose latest run is `PASSED`. The successor records `sourceProjectId`, `sourceProjectName`, `sourceRunId`, `derivationMode`, and an optional `changeRequest`.

The source project and its evidence remain unchanged. A successor copies the source project's frozen Team snapshot and project memory. `UPGRADE` restores the immutable delivery snapshot from the passed run before Agent execution; `REGENERATE` starts from an empty workspace. A passed run now stores its safe delivery snapshot beside the run workspace.

SQLite schema v9 and the `20261104090000_add_project_derivation` PostgreSQL migration add the lineage columns and index. Existing projects keep their current behavior.

## Migration

1. Apply the PostgreSQL migration or let SQLite open an existing database through its normal schema migration.
2. Keep the existing workspace root readable and writable. Upgrade derivation reads the source run workspace and creates a delivery snapshot when an older passed project has none.
3. Use a published and frozen Team for the source project. The derivation copies that exact snapshot instead of resolving the Team again.
4. Expect `409` when the source has an active run, its latest run is not `PASSED`, it has no workspace or safe snapshot, or it has no frozen Team.
5. Do not delete the source project until its successor has been created and the new run has started.
