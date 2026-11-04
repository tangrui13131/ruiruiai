-- Add project lineage for creating immutable upgrade successors.
ALTER TABLE "projects"
ADD COLUMN "source_project_id" TEXT,
ADD COLUMN "source_project_name" TEXT,
ADD COLUMN "source_run_id" TEXT,
ADD COLUMN "derivation_mode" TEXT,
ADD COLUMN "change_request" TEXT;

CREATE INDEX "projects_source_project_id_idx"
ON "projects"("source_project_id");
