-- What has actually been handed to a member of staff.
--
-- Everything else in payroll is derived: the hours come off the calendar and
-- price themselves, so asking "what did she earn in August" has always had an
-- answer. "What do we still owe her" did not, because nothing recorded the
-- money going the other way — every screen recomputed a period and none of them
-- could ever reach zero.
--
-- One row per payment. The balance is earnings minus these, which means a
-- payment is the only write in the whole of payroll: hours stay computed, so
-- correcting a calendar entry still corrects the pay it produced.
--
-- ADJUSTMENT exists because the earnings side starts the day the calendar does,
-- and no ledger survives contact with history that predates it. An adjustment
-- is a signed line an admin writes to say "and this is where we actually
-- stood" — an opening balance, a correction, a bonus — without touching an hour
-- that really was worked.

CREATE TYPE "teacher_payment_kind" AS ENUM ('payment', 'adjustment');

CREATE TYPE "payout_method" AS ENUM (
  'cash', 'check', 'zelle', 'venmo', 'paypal', 'direct_deposit', 'other'
);

CREATE TABLE "teacher_payments" (
  "id"          UUID NOT NULL,
  "teacher_id"  UUID NOT NULL,
  "kind"        "teacher_payment_kind" NOT NULL DEFAULT 'payment',
  -- Signed. A payment is positive and reduces the balance; an adjustment may be
  -- either, so a correction can go in the direction the mistake went.
  "amount"      DECIMAL(10,2) NOT NULL,
  "method"      "payout_method",
  -- The day the money moved, not the day somebody typed it in: a cheque written
  -- on Friday and recorded on Monday belongs to Friday's week.
  "paid_at"     DATE NOT NULL,
  "reference"   VARCHAR(120),
  "notes"       TEXT,
  "recorded_by" UUID,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "teacher_payments_pkey" PRIMARY KEY ("id")
);

-- Every read is "this person's ledger, oldest first", so the index is the sort.
CREATE INDEX "teacher_payments_teacher_id_paid_at_idx"
  ON "teacher_payments"("teacher_id", "paid_at");

ALTER TABLE "teacher_payments"
  ADD CONSTRAINT "teacher_payments_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teacher_payments"
  ADD CONSTRAINT "teacher_payments_recorded_by_fkey"
  FOREIGN KEY ("recorded_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
