-- What one student pays for one meeting, when it isn't the meeting's price.
--
-- Session.charge_amount is a single number for the whole roster, which is right
-- until somebody's fee already covers the room they are sitting in: the 8th
-- grade programme runs the full day for $2,000 a quarter, and those students
-- spend it inside the same coves and electives everyone else pays $400 and $130
-- for. Charging them again for a room their tuition already bought is what this
-- prevents — $3,050 across two students in the first term it applied.
CREATE TABLE "session_charge_overrides" (
  "id"         UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  -- An amount, not a boolean: "free for her" and "reduced to $50" are the same
  -- decision at different numbers. 0 means charged nothing; no row at all means
  -- the meeting's own price applies.
  "amount"     DECIMAL(10,2) NOT NULL,
  "reason"     VARCHAR(255),
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "session_charge_overrides_pkey" PRIMARY KEY ("id")
);

-- One ruling per student per meeting.
CREATE UNIQUE INDEX "session_charge_overrides_session_id_student_id_key"
  ON "session_charge_overrides"("session_id", "student_id");

CREATE INDEX "session_charge_overrides_student_id_idx"
  ON "session_charge_overrides"("student_id");

-- Cascade on the session and the student: an override is meaningless without
-- both, and leaving orphans behind would quietly re-price a rebuilt roster.
ALTER TABLE "session_charge_overrides"
  ADD CONSTRAINT "session_charge_overrides_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_charge_overrides"
  ADD CONSTRAINT "session_charge_overrides_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- But keep the record of who decided it even if that admin's account goes.
ALTER TABLE "session_charge_overrides"
  ADD CONSTRAINT "session_charge_overrides_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
