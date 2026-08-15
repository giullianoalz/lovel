-- Salaried hours must never carry a frozen rate.
--
-- A manager on $63,000/yr does not also collect $50/hr for the classes that
-- salary already pays for. freezeSessionRates knows that and skips them — but
-- it was reading the teacher without selecting `base_salary`, so every salaried
-- person looked hourly to it and their hours were stamped at the category rate
-- and paid on top of the salary.
--
-- 20260813180000_unfreeze_salaried_hours cleared the stamps; it did not close
-- the hole that made them, so they came back. The select is fixed now (see
-- payroll.service.js), and this clears what leaked through in the meantime.
--
-- Only the stamp is dropped, never the hour: an unstamped hour prices live, so
-- these sessions go back to costing what the rate cascade says they cost —
-- nothing, while the person is salaried, and a real rate again the day they
-- move onto hourly.
UPDATE "sessions" s
SET "paid_rate" = NULL, "paid_rate_source" = NULL
FROM "classes" c, "users" u
WHERE s."class_id" = c."id"
  AND c."teacher_id" = u."id"
  AND u."base_salary" IS NOT NULL
  AND s."paid_rate" IS NOT NULL;

UPDATE "work_shifts" w
SET "paid_rate" = NULL, "paid_rate_source" = NULL
FROM "users" u
WHERE w."staff_id" = u."id"
  AND u."base_salary" IS NOT NULL
  AND w."paid_rate" IS NOT NULL;
