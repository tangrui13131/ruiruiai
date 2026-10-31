-- CreateTable
CREATE TABLE "project_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "fencing_token" BIGINT NOT NULL,
    "workspace_path" TEXT NOT NULL,
    "preview_path" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "error_json" JSONB,

    CONSTRAINT "project_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_runs_project_id_started_at_idx" ON "project_runs"("project_id", "started_at");

-- Enforce one active run per project.
CREATE UNIQUE INDEX "project_runs_one_active_idx"
ON "project_runs"("project_id")
WHERE "status" = 'RUNNING';

-- AddForeignKey
ALTER TABLE "project_runs"
ADD CONSTRAINT "project_runs_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
