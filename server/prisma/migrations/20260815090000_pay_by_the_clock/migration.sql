-- Pay accrues from the calendar: an hour that has passed is an hour that is
-- owed, with nobody asked to confirm it. The only way an elapsed hour stops
-- being paid is somebody marking the person absent on the calendar entry —
-- which is what these columns record, for classes and for shifts alike.
ALTER TABLE "sessions"
  ADD COLUMN "absent_at" TIMESTAMPTZ(6),
  ADD COLUMN "absent_by" UUID,
  ADD COLUMN "absent_reason" VARCHAR(255);

ALTER TABLE "work_shifts"
  ADD COLUMN "absent_at" TIMESTAMPTZ(6),
  ADD COLUMN "absent_by" UUID,
  ADD COLUMN "absent_reason" VARCHAR(255);

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_absent_by_fkey"
  FOREIGN KEY ("absent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_shifts"
  ADD CONSTRAINT "work_shifts_absent_by_fkey"
  FOREIGN KEY ("absent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
