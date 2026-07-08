-- CreateEnum
CREATE TYPE "group_type" AS ENUM ('REGULAR', 'ANCHORED');

-- CreateEnum
CREATE TYPE "ixl_plan" AS ENUM ('NONE', 'CORE', 'CORE_SPANISH');

-- CreateEnum
CREATE TYPE "registration_email_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "file_type" VARCHAR(100),
ADD COLUMN     "file_url" TEXT;

-- AlterTable
ALTER TABLE "chat_participants" ADD COLUMN     "last_read_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "group_type" "group_type" NOT NULL DEFAULT 'REGULAR';

-- AlterTable
ALTER TABLE "registration_requests" ADD COLUMN     "base_rate" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deposit_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deposit_due_date" DATE,
ADD COLUMN     "electives_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "email_sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "email_status" "registration_email_status" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "ixl_plan" "ixl_plan" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "ixl_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total_quarterly" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "registration_terms" ADD COLUMN     "anchored_rate" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "calendar_asset_url" TEXT,
ADD COLUMN     "deposit_due_date" DATE,
ADD COLUMN     "regular_rate" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "session_cancellations" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "cancelled_by" UUID NOT NULL,
    "reason" TEXT,
    "hours_before_class" DECIMAL(6,2) NOT NULL,
    "suggested_charge_percent" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING_REVIEW',
    "final_charge_percent" INTEGER,
    "charge_amount" DECIMAL(10,2),
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_settings" (
    "id" UUID NOT NULL,
    "class_reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
    "class_reminder_minutes_before" INTEGER NOT NULL DEFAULT 15,
    "absence_alert_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "academy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "electives" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 130,

    CONSTRAINT "electives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_elective_choices" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "elective_id" UUID NOT NULL,

    CONSTRAINT "registration_elective_choices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_cancellations_status_idx" ON "session_cancellations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "session_cancellations_session_id_student_id_key" ON "session_cancellations"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "electives_term_id_idx" ON "electives"("term_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_elective_choices_request_id_elective_id_key" ON "registration_elective_choices"("request_id", "elective_id");

-- AddForeignKey
ALTER TABLE "session_cancellations" ADD CONSTRAINT "session_cancellations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_cancellations" ADD CONSTRAINT "session_cancellations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_cancellations" ADD CONSTRAINT "session_cancellations_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_cancellations" ADD CONSTRAINT "session_cancellations_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electives" ADD CONSTRAINT "electives_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "registration_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_elective_choices" ADD CONSTRAINT "registration_elective_choices_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "registration_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_elective_choices" ADD CONSTRAINT "registration_elective_choices_elective_id_fkey" FOREIGN KEY ("elective_id") REFERENCES "electives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
