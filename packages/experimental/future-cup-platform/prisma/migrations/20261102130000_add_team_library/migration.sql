-- Create logical Team ownership and expand legacy member counts into runtime rows.
CREATE TABLE "agent_teams" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_teams_owner_id_name_key"
ON "agent_teams"("owner_id", "name");

INSERT INTO "agent_teams" (
    "id", "owner_id", "name", "purpose", "status", "created_at", "updated_at"
)
SELECT
    'legacy-team:' || grouped.min_id,
    'legacy',
    grouped."name",
    COALESCE(canonical."spec_json" ->> 'purpose', 'Legacy Agent team'),
    'ACTIVE',
    grouped.min_created_at,
    grouped.max_updated_at
FROM (
    SELECT
        "name",
        MIN("id") AS min_id,
        MIN("created_at") AS min_created_at,
        MAX(COALESCE("published_at", "created_at")) AS max_updated_at
    FROM "agent_team_versions"
    GROUP BY "name"
) AS grouped
JOIN "agent_team_versions" AS canonical
  ON canonical."name" = grouped."name" AND canonical."id" = grouped.min_id;

ALTER TABLE "agent_team_versions" ADD COLUMN "team_id" TEXT;

UPDATE "agent_team_versions" AS tv
SET "team_id" = (
    SELECT 'legacy-team:' || MIN(peer."id")
    FROM "agent_team_versions" AS peer
    WHERE peer."name" = tv."name"
)
WHERE tv."team_id" IS NULL;

ALTER TABLE "agent_team_versions" ALTER COLUMN "team_id" SET NOT NULL;

ALTER TABLE "agent_team_versions"
ADD CONSTRAINT "agent_team_versions_team_id_fkey"
FOREIGN KEY ("team_id") REFERENCES "agent_teams"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "agent_team_versions_name_version_key";

CREATE UNIQUE INDEX "agent_team_versions_team_id_version_key"
ON "agent_team_versions"("team_id", "version");

CREATE TABLE "agent_team_members_v2" (
    "team_version_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "agent_definition_version_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "department_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "agent_team_members_v2_pkey"
      PRIMARY KEY ("team_version_id", "member_id")
);

WITH expanded AS (
    SELECT
        tv."id" AS "team_version_id",
        (member."elem" -> 'version' ->> 'id') AS "agent_definition_version_id",
        (member."elem" -> 'version' ->> 'role') AS "role",
        (member."elem" -> 'definition' ->> 'name') AS "definition_name",
        (member."elem" ->> 'instanceCount')::integer AS "instance_count",
        member."ordinal" AS "member_ordinal",
        inst."instance_number" AS "instance_number"
    FROM "agent_team_versions" AS tv
    CROSS JOIN LATERAL jsonb_array_elements(tv."spec_json" -> 'members')
        WITH ORDINALITY AS member("elem", "ordinal")
    CROSS JOIN LATERAL generate_series(
        1,
        (member."elem" ->> 'instanceCount')::integer
    ) AS inst("instance_number")
),
with_department AS (
    SELECT
        "team_version_id",
        "agent_definition_version_id",
        "definition_name",
        "instance_count",
        "member_ordinal",
        "instance_number",
        CASE "role"
            WHEN 'planner' THEN 'planning'
            WHEN 'ui-designer' THEN 'design'
            WHEN 'frontend' THEN
                CASE WHEN "instance_number" % 2 = 1 THEN 'frontend-a' ELSE 'frontend-b' END
            WHEN 'integration' THEN 'integration'
            WHEN 'tester' THEN 'verification'
            WHEN 'verifier' THEN 'verification'
            WHEN 'repair' THEN 'repair'
            ELSE 'planning'
        END AS "department_key"
    FROM expanded
)
INSERT INTO "agent_team_members_v2" (
    "team_version_id",
    "member_id",
    "agent_definition_version_id",
    "display_name",
    "department_key",
    "position"
)
SELECT
    "team_version_id",
    "agent_definition_version_id" || ':instance-' || ROW_NUMBER() OVER (
        PARTITION BY "team_version_id", "agent_definition_version_id"
        ORDER BY "member_ordinal", "instance_number"
    ),
    "agent_definition_version_id",
    CASE WHEN "instance_count" = 1
         THEN "definition_name"
         ELSE "definition_name" || ' ' || "instance_number"
    END,
    "department_key",
    ROW_NUMBER() OVER (
        PARTITION BY "team_version_id", "department_key"
        ORDER BY "member_ordinal", "instance_number"
    )
FROM with_department;

DROP TABLE "agent_team_members";
ALTER TABLE "agent_team_members_v2" RENAME TO "agent_team_members";

CREATE UNIQUE INDEX "agent_team_members_team_version_id_department_key_position_key"
ON "agent_team_members"("team_version_id", "department_key", "position");

ALTER TABLE "agent_team_members"
ADD CONSTRAINT "agent_team_members_team_version_id_fkey"
FOREIGN KEY ("team_version_id") REFERENCES "agent_team_versions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_team_members"
ADD CONSTRAINT "agent_team_members_agent_definition_version_id_fkey"
FOREIGN KEY ("agent_definition_version_id") REFERENCES "agent_definition_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "agent_team_members_agent_definition_version_id_idx"
ON "agent_team_members"("agent_definition_version_id");

CREATE INDEX "agent_team_versions_team_id_idx"
ON "agent_team_versions"("team_id");
