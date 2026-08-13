-- Add archive support to lesson plans
ALTER TABLE "lesson_plans" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lesson_plans" ADD COLUMN "archived_at" TIMESTAMPTZ(6);

CREATE INDEX "lesson_plans_archived_idx" ON "lesson_plans"("archived");
