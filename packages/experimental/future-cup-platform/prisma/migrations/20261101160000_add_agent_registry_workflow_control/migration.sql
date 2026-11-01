-- CreateTable
CREATE TABLE "agent_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "discovery_tags_json" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_definition_versions" (
    "id" TEXT NOT NULL,
    "agent_definition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "spec_json" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "deprecated_at" TIMESTAMP(3),

    CONSTRAINT "agent_definition_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_team_versions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "spec_json" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "agent_team_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_team_members" (
    "team_version_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "agent_definition_version_id" TEXT NOT NULL,
    "instance_count" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "agent_team_members_pkey" PRIMARY KEY ("team_version_id","member_id")
);

-- CreateTable
CREATE TABLE "project_team_bindings" (
    "project_id" TEXT NOT NULL,
    "team_version_id" TEXT NOT NULL,
    "frozen_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_team_bindings_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "project_memory_entries" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph_json" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id","version")
);

-- CreateTable
CREATE TABLE "workflow_control_runs" (
    "project_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "definition_version" INTEGER NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_control_runs_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "workflow_control_events" (
    "seq" BIGSERIAL NOT NULL,
    "project_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_control_events_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "agent_definitions_status_idx" ON "agent_definitions"("status");

-- CreateIndex
CREATE INDEX "agent_definitions_discovery_tags_json_idx"
ON "agent_definitions" USING GIN ("discovery_tags_json");

-- CreateIndex
CREATE INDEX "agent_definition_versions_status_idx" ON "agent_definition_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_definition_versions_agent_definition_id_version_key"
ON "agent_definition_versions"("agent_definition_id", "version");

-- CreateIndex
CREATE INDEX "agent_team_versions_status_idx" ON "agent_team_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_team_versions_name_version_key"
ON "agent_team_versions"("name", "version");

-- CreateIndex
CREATE INDEX "agent_team_members_agent_definition_version_id_idx"
ON "agent_team_members"("agent_definition_version_id");

-- CreateIndex
CREATE INDEX "project_team_bindings_team_version_id_idx"
ON "project_team_bindings"("team_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_memory_entries_project_id_kind_key_key"
ON "project_memory_entries"("project_id", "kind", "key");

-- CreateIndex
CREATE INDEX "workflow_definitions_status_idx" ON "workflow_definitions"("status");

-- CreateIndex
CREATE INDEX "workflow_control_runs_definition_id_definition_version_idx"
ON "workflow_control_runs"("definition_id", "definition_version");

-- CreateIndex
CREATE INDEX "workflow_control_runs_status_idx" ON "workflow_control_runs"("status");

-- CreateIndex
CREATE INDEX "workflow_control_events_project_id_seq_idx"
ON "workflow_control_events"("project_id", "seq");

-- CreateIndex
-- AddForeignKey
ALTER TABLE "agent_definition_versions"
ADD CONSTRAINT "agent_definition_versions_agent_definition_id_fkey"
FOREIGN KEY ("agent_definition_id") REFERENCES "agent_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_team_members"
ADD CONSTRAINT "agent_team_members_team_version_id_fkey"
FOREIGN KEY ("team_version_id") REFERENCES "agent_team_versions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_team_members"
ADD CONSTRAINT "agent_team_members_agent_definition_version_id_fkey"
FOREIGN KEY ("agent_definition_version_id") REFERENCES "agent_definition_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_team_bindings"
ADD CONSTRAINT "project_team_bindings_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_team_bindings"
ADD CONSTRAINT "project_team_bindings_team_version_id_fkey"
FOREIGN KEY ("team_version_id") REFERENCES "agent_team_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memory_entries"
ADD CONSTRAINT "project_memory_entries_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_control_runs"
ADD CONSTRAINT "workflow_control_runs_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_control_runs"
ADD CONSTRAINT "workflow_control_runs_definition_id_definition_version_fkey"
FOREIGN KEY ("definition_id", "definition_version") REFERENCES "workflow_definitions"("id", "version")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_control_events"
ADD CONSTRAINT "workflow_control_events_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
