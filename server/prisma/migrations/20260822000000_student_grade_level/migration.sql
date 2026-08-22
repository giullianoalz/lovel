-- The school grade a student is in ("K", "1st".."12th"). Nullable: every
-- existing student predates the field and nobody knows their grade yet.
ALTER TABLE "users" ADD COLUMN "grade_level" VARCHAR(10);
