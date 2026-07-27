-- CreateEnum
CREATE TYPE "application_status" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "enrollment_applications" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "status" "application_status" NOT NULL DEFAULT 'PENDING',
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ixlPlan" "ixl_plan" NOT NULL DEFAULT 'NONE',
    "scholarship" BOOLEAN NOT NULL DEFAULT false,
    "parent_notes" TEXT,
    "staff_notes" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrollment_applications_status_idx" ON "enrollment_applications"("status");

-- CreateIndex
CREATE INDEX "enrollment_applications_family_id_idx" ON "enrollment_applications"("family_id");

-- AddForeignKey
ALTER TABLE "enrollment_applications" ADD CONSTRAINT "enrollment_applications_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_applications" ADD CONSTRAINT "enrollment_applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_applications" ADD CONSTRAINT "enrollment_applications_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_applications" ADD CONSTRAINT "enrollment_applications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
