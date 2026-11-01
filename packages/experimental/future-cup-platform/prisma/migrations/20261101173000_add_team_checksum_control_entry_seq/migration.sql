-- Add immutable Agent team checksums.
ALTER TABLE "agent_team_versions"
ADD COLUMN IF NOT EXISTS "checksum" TEXT NOT NULL DEFAULT '';

ALTER TABLE "agent_team_versions"
ALTER COLUMN "checksum" DROP DEFAULT;

-- Give existing control journal rows a project-local monotonic entry sequence.
ALTER TABLE "workflow_control_events"
ADD COLUMN IF NOT EXISTS "entry_seq" INTEGER;

WITH numbered AS (
  SELECT
    "seq",
    row_number() OVER (
      PARTITION BY "project_id"
      ORDER BY "seq"
    ) AS "entry_seq"
  FROM "workflow_control_events"
)
UPDATE "workflow_control_events" AS events
SET "entry_seq" = numbered."entry_seq"
FROM numbered
WHERE events."seq" = numbered."seq";

ALTER TABLE "workflow_control_events"
ALTER COLUMN "entry_seq" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_control_events_project_id_entry_seq_key"
ON "workflow_control_events"("project_id", "entry_seq");
