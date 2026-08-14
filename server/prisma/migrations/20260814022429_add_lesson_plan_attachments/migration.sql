-- DropIndex
DROP INDEX "sessions_pay_approved_at_idx";

-- CreateTable
CREATE TABLE "lesson_plan_attachments" (
    "id" UUID NOT NULL,
    "lesson_plan_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_plan_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_plan_attachments_lesson_plan_id_idx" ON "lesson_plan_attachments"("lesson_plan_id");

-- AddForeignKey
ALTER TABLE "lesson_plan_attachments" ADD CONSTRAINT "lesson_plan_attachments_lesson_plan_id_fkey" FOREIGN KEY ("lesson_plan_id") REFERENCES "lesson_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
