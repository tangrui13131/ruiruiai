-- CreateTable
CREATE TABLE "repair_strategy_decisions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repair_round" INTEGER NOT NULL,
    "failure_signature" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "decision_json" JSONB NOT NULL,
    "outcome_json" JSONB,
    "repair_record_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_strategy_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repair_strategy_decisions_project_id_repair_round_key"
ON "repair_strategy_decisions"("project_id", "repair_round");

-- CreateIndex
CREATE UNIQUE INDEX "repair_strategy_decisions_repair_record_id_key"
ON "repair_strategy_decisions"("repair_record_id");

-- CreateIndex
CREATE INDEX "repair_strategy_decisions_project_id_repair_round_idx"
ON "repair_strategy_decisions"("project_id", "repair_round");

-- AddForeignKey
ALTER TABLE "repair_strategy_decisions"
ADD CONSTRAINT "repair_strategy_decisions_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_strategy_decisions"
ADD CONSTRAINT "repair_strategy_decisions_repair_record_id_fkey"
FOREIGN KEY ("repair_record_id") REFERENCES "repair_records"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
