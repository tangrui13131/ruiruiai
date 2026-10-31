-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "max_concurrency" INTEGER NOT NULL,
    "current_load" INTEGER NOT NULL DEFAULT 0,
    "historical_success_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT,
    "name" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "last_event_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "required_capabilities" JSONB NOT NULL,
    "write_scopes" JSONB NOT NULL,
    "page_id" TEXT,
    "snapshot_json" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "assigned_agent_id" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("project_id","id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "depends_on_task_id" TEXT NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("project_id","task_id","depends_on_task_id")
);

-- CreateTable
CREATE TABLE "task_journal" (
    "seq" BIGSERIAL NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "reason" TEXT,
    "snapshot_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_journal_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "scheduler_decisions" (
    "seq" BIGSERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "decision_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduler_decisions_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "session_id" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "error_json" JSONB,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_events" (
    "seq" BIGSERIAL NOT NULL,
    "execution_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_events_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "verification_reports" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "status" TEXT NOT NULL,
    "failure_signature" TEXT,
    "report_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_records" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repair_round" INTEGER NOT NULL,
    "verification_report_id" TEXT NOT NULL,
    "repair_agent_id" TEXT NOT NULL,
    "failure_signature" TEXT NOT NULL,
    "error_summary" TEXT NOT NULL,
    "change_summary" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    "before_status" TEXT NOT NULL,
    "after_status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "repair_round" INTEGER NOT NULL,
    "escalation_reason" TEXT,
    "escalation_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "task_id" TEXT,
    "agent_id" TEXT,
    "payload_json" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "event_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "claim_owner_id" TEXT,
    "claim_token" TEXT,
    "claimed_at" TIMESTAMP(3),
    "claim_expires_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "workflow_leases" (
    "resource_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT,
    "fencing_token" BIGINT NOT NULL DEFAULT 0,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_leases_pkey" PRIMARY KEY ("resource_id")
);

-- CreateIndex
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id", "status");

-- CreateIndex
CREATE INDEX "task_journal_project_id_seq_idx" ON "task_journal"("project_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "task_journal_project_id_task_id_revision_key" ON "task_journal"("project_id", "task_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "scheduler_decisions_id_key" ON "scheduler_decisions"("id");

-- CreateIndex
CREATE INDEX "scheduler_decisions_project_id_seq_idx" ON "scheduler_decisions"("project_id", "seq");

-- CreateIndex
CREATE INDEX "executions_project_id_task_id_idx" ON "executions"("project_id", "task_id");

-- CreateIndex
CREATE INDEX "execution_events_execution_id_seq_idx" ON "execution_events"("execution_id", "seq");

-- CreateIndex
CREATE INDEX "verification_reports_project_id_created_at_idx" ON "verification_reports"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "repair_records_project_id_repair_round_idx" ON "repair_records"("project_id", "repair_round");

-- CreateIndex
CREATE UNIQUE INDEX "repair_records_project_id_repair_round_key" ON "repair_records"("project_id", "repair_round");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_project_id_key" ON "workflow_runs"("project_id");

-- CreateIndex
CREATE INDEX "product_events_project_id_seq_idx" ON "product_events"("project_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "product_events_project_id_seq_key" ON "product_events"("project_id", "seq");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_claim_expires_at_idx" ON "outbox_events"("published_at", "claim_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_leases_project_id_key" ON "workflow_leases"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "tasks"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_project_id_depends_on_task_id_fkey" FOREIGN KEY ("project_id", "depends_on_task_id") REFERENCES "tasks"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_journal" ADD CONSTRAINT "task_journal_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_journal" ADD CONSTRAINT "task_journal_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "tasks"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduler_decisions" ADD CONSTRAINT "scheduler_decisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_reports" ADD CONSTRAINT "verification_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_records" ADD CONSTRAINT "repair_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_records" ADD CONSTRAINT "repair_records_verification_report_id_fkey" FOREIGN KEY ("verification_report_id") REFERENCES "verification_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "product_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_leases" ADD CONSTRAINT "workflow_leases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
