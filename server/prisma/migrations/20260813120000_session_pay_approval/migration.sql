-- Paying an hour nobody closed out.
--
-- A class is normally confirmed by the teacher: marked complete, register
-- saved. Teachers forget, and the hour was still taught — payroll would flag it
-- ("3 h not closed out") and then refuse to pay it, so the only way to settle
-- was outside the system entirely.
--
-- This is the way back in: an admin vouches that the class ran, and the session
-- becomes payable with no register. Who and when rather than a boolean —
-- somebody is authorising money against no evidence, so the record names them.

ALTER TABLE "sessions" ADD COLUMN "pay_approved_by" UUID;
ALTER TABLE "sessions" ADD COLUMN "pay_approved_at" TIMESTAMPTZ(6);

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_pay_approved_by_fkey"
    FOREIGN KEY ("pay_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payroll asks "which of this month's sessions were approved" on every load,
-- and the answer is a handful of rows out of the whole table.
CREATE INDEX "sessions_pay_approved_at_idx" ON "sessions"("pay_approved_at");
