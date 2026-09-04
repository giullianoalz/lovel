-- Who taught the hour, and who was on the roster when it ran.
--
-- Both columns exist for the same reason: a class is a live object and the
-- history hangs off it, so editing the class rewrote the past. Reassigning a
-- class moved every session already taught onto the new teacher's payslip;
-- changing the roster restated who had been in the room. These freeze the two
-- facts at the moment they stop being true.
--
-- Both are NULL for every existing row on purpose. NULL means "ask the class",
-- which is exactly what the code did before, so nothing already recorded moves.

ALTER TABLE "sessions" ADD COLUMN "teacher_id" UUID;

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sessions_teacher_id_idx" ON "sessions"("teacher_id");

ALTER TABLE "class_enrollments" ADD COLUMN "ended_at" TIMESTAMPTZ(6);
