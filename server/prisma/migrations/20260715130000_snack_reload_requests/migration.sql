-- CreateTable
CREATE TABLE "snack_reload_requests" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "family_id" UUID,
    "punch_count" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "triggered_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "fulfilled_by" UUID,
    "fulfilled_at" TIMESTAMPTZ(6),
    "transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snack_reload_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snack_reload_requests_status_idx" ON "snack_reload_requests"("status");

-- CreateIndex
CREATE INDEX "snack_reload_requests_student_id_idx" ON "snack_reload_requests"("student_id");

-- AddForeignKey
ALTER TABLE "snack_reload_requests" ADD CONSTRAINT "snack_reload_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snack_reload_requests" ADD CONSTRAINT "snack_reload_requests_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snack_reload_requests" ADD CONSTRAINT "snack_reload_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snack_reload_requests" ADD CONSTRAINT "snack_reload_requests_fulfilled_by_fkey" FOREIGN KEY ("fulfilled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
