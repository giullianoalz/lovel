-- The rate an hour was actually worked at, written down when it is confirmed.
--
-- Until now pay was always computed from today's rates, so raising somebody's
-- rate in March silently repriced February: an hour worked under one contract
-- was paid under the next one. Stamping the rate at the moment the work is
-- confirmed — a session marked COMPLETED, a shift marked worked — makes a
-- closed month permanent, and leaves everything not yet signed off still
-- pricing live, so fixing a wrong rate keeps working.
--
-- Nullable, and backfilled below only where a rate can be reconstructed.

-- IF NOT EXISTS because the columns may already be in place from a `db push`
-- against a working database. The backfill below is the part that matters and
-- it must still run, so the whole file is written to be safe to re-apply.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "paid_rate" DECIMAL(10,2);
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "paid_rate_source" VARCHAR(20);

ALTER TABLE "work_shifts" ADD COLUMN IF NOT EXISTS "paid_rate" DECIMAL(10,2);
ALTER TABLE "work_shifts" ADD COLUMN IF NOT EXISTS "paid_rate_source" VARCHAR(20);

-- Backfill: every session already COMPLETED gets today's rate frozen onto it,
-- because today's rate is the only one that was ever in force for it — no rate
-- has been changed since this column existed. Doing it now rather than leaving
-- them null means the first rate change after this deploy cannot reach back
-- and reprice work that was already signed off.
--
-- The cascade is reproduced in SQL exactly as payroll.service.js resolves it:
-- a rate on the entry, then the person's flat rate, then their rate for that
-- category, then the category's own rate, then their base hourly rate.
-- The category has to be worked out before it can be joined on, and an UPDATE's
-- FROM clause cannot reach back to the row being updated — hence the CTE.
WITH resolved AS (
  SELECT
    s."id",
    s."pay_rate_override",
    u."id" AS teacher_id,
    u."flat_rate_only",
    u."hourly_rate",
    -- The same fallback the engine applies to a session with no category:
    -- online if this meeting has a link (or the whole class is virtual),
    -- in person otherwise.
    COALESCE(
      s."pay_category_key",
      CASE WHEN COALESCE(
        s."meeting_url",
        CASE WHEN c."type" = 'virtual' THEN c."meeting_url" END
      ) IS NOT NULL THEN 'ONLINE' ELSE 'IN_PERSON' END
    ) AS category_key
  FROM "sessions" s
  JOIN "classes" c ON c."id" = s."class_id"
  JOIN "users" u ON u."id" = c."teacher_id"
  WHERE s."status" = 'completed'
    AND s."paid_rate" IS NULL
)
UPDATE "sessions" s
SET
  "paid_rate" = COALESCE(
    r."pay_rate_override",
    CASE WHEN r."flat_rate_only" THEN r."hourly_rate" END,
    tpr."hourly_rate",
    pc."default_rate",
    r."hourly_rate",
    0
  ),
  "paid_rate_source" = CASE
    WHEN r."pay_rate_override" IS NOT NULL THEN 'event'
    WHEN r."flat_rate_only" AND r."hourly_rate" IS NOT NULL THEN 'flat'
    WHEN tpr."hourly_rate" IS NOT NULL THEN 'teacher'
    WHEN pc."default_rate" IS NOT NULL THEN 'category'
    WHEN r."hourly_rate" IS NOT NULL THEN 'base'
    ELSE 'unset'
  END
FROM resolved r
LEFT JOIN "teacher_pay_rates" tpr
  ON tpr."teacher_id" = r."teacher_id" AND tpr."category" = r."category_key"
LEFT JOIN "pay_categories" pc ON pc."key" = r."category_key"
WHERE s."id" = r."id";

-- Scalar subqueries rather than joins: a shift may legitimately have no
-- category, and a join on a null key would drop the row from the backfill
-- instead of pricing it at the person's base rate.
UPDATE "work_shifts" w
SET
  "paid_rate" = COALESCE(
    w."pay_rate_override",
    CASE WHEN u."flat_rate_only" THEN u."hourly_rate" END,
    (SELECT tpr."hourly_rate" FROM "teacher_pay_rates" tpr
      WHERE tpr."teacher_id" = u."id" AND tpr."category" = w."pay_category_key"),
    (SELECT pc."default_rate" FROM "pay_categories" pc WHERE pc."key" = w."pay_category_key"),
    u."hourly_rate",
    0
  ),
  "paid_rate_source" = CASE
    WHEN w."pay_rate_override" IS NOT NULL THEN 'event'
    WHEN u."flat_rate_only" AND u."hourly_rate" IS NOT NULL THEN 'flat'
    WHEN (SELECT tpr."hourly_rate" FROM "teacher_pay_rates" tpr
           WHERE tpr."teacher_id" = u."id" AND tpr."category" = w."pay_category_key") IS NOT NULL THEN 'teacher'
    WHEN (SELECT pc."default_rate" FROM "pay_categories" pc
           WHERE pc."key" = w."pay_category_key") IS NOT NULL THEN 'category'
    WHEN u."hourly_rate" IS NOT NULL THEN 'base'
    ELSE 'unset'
  END
FROM "users" u
WHERE w."staff_id" = u."id"
  AND w."status" = 'completed'
  AND w."paid_rate" IS NULL;
