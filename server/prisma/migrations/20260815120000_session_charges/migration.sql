-- A price on one calendar entry, charged to every family enrolled in it.
--
-- The other half of the pay override already on sessions: that one decides what
-- the hour pays the teacher, this one decides what it bills the client. Null
-- means the meeting raises nothing, which is what almost every session stays —
-- most classes are paid for by the term through the quarterly run, and would be
-- billed twice if every session also carried a price.
ALTER TABLE "sessions"
  ADD COLUMN "charge_amount" DECIMAL(10,2),
  ADD COLUMN "charge_note" VARCHAR(255);

-- Which session a charge came from, so the ledger can say what raised it and an
-- admin can get back to the calendar entry to correct it.
ALTER TABLE "transactions" ADD COLUMN "session_id" UUID;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One meeting can never bill the same student twice, however many times the
-- approval is re-run or double-clicked. Postgres treats NULLs as distinct, so
-- every charge that did not come from a session is untouched by this — the same
-- guarantee (studentId, term_id, quarter) already gives the quarterly run.
CREATE UNIQUE INDEX "transactions_student_id_session_id_key"
  ON "transactions"("student_id", "session_id");
