-- Salaried staff are hired on a yearly figure, but payroll runs monthly. Until
-- now `base_salary` was read as a monthly amount with no way to say otherwise,
-- so an annual salary entered as-is (63,000) was billed as 63,000 *per month*.
-- This records which of the two the stored number is.

CREATE TYPE "salary_period" AS ENUM ('monthly', 'annual');

-- Defaults to monthly so every existing row keeps behaving exactly as it does
-- today. Rows that are really annual are flipped from the payroll screen by an
-- admin, deliberately: guessing here — "anything above X must be yearly" —
-- would quietly change what someone is paid.
ALTER TABLE "users"
  ADD COLUMN "salary_period" "salary_period" NOT NULL DEFAULT 'monthly';
