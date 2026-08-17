-- Append-only log of the door. `attendance` is state (one row per child per
-- session, overwritten when they come back in); this is the record of each
-- arrival and departure as it happened, with who recorded it and how.
CREATE TABLE "attendance_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "status" "attendance_status",
    "source" VARCHAR(20) NOT NULL,
    "by_user_id" UUID,
    "released_to" VARCHAR(255),
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_events_session_id_idx" ON "attendance_events"("session_id");
CREATE INDEX "attendance_events_student_id_at_idx" ON "attendance_events"("student_id", "at");
CREATE INDEX "attendance_events_at_idx" ON "attendance_events"("at");

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: a staff member leaving the academy must not delete the
-- record of the doors they worked.
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_by_user_id_fkey"
    FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
