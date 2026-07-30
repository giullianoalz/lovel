-- A term is billed in two quarters at the same rate. Q1 runs from the term's
-- startDate; this records when Q2 begins, which is when its charges are raised.
ALTER TABLE "registration_terms" ADD COLUMN "quarter2_starts_at" TIMESTAMPTZ(6);

-- Stamped only on tuition raised by the quarterly billing run, so a repeat run
-- can tell what it already charged.
ALTER TABLE "transactions" ADD COLUMN "term_id" UUID;
ALTER TABLE "transactions" ADD COLUMN "quarter" INTEGER;

-- The guard against double-charging: one tuition row per student per quarter,
-- enforced by the database rather than by whoever clicks the button twice.
-- Postgres treats NULLs as distinct, so every pre-existing transaction (and any
-- future non-tuition one) is unaffected by this.
CREATE UNIQUE INDEX "transactions_student_id_term_id_quarter_key"
  ON "transactions" ("student_id", "term_id", "quarter");
