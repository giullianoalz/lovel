-- Stop paying salaried staff twice for hours that were frozen too early.
--
-- Two correct rules landed in the wrong order. Freezing stamps the resolved
-- rate onto a session the moment it is confirmed, so the hour keeps the deal it
-- was worked under. Separately, salaried staff resolve to $0/hr, because a
-- teacher on $63,000/yr is already paid for teaching — the salary IS the pay.
--
-- The freezing shipped first. Between the two, every confirmed class for a
-- salaried teacher was stamped with the category rate, and those stamps kept
-- paying on top of the salary afterwards: two people, eleven sessions, ~$2,900
-- a month of double pay that no rule in the code would ever have produced.
--
-- Clearing the stamp is the fix rather than rewriting it to 0: unfrozen hours
-- price live, so they now resolve through the salaried rule and will re-freeze
-- correctly the next time anything touches them. It also means that if one of
-- these people later moves off salary onto an hourly rate, their hours price
-- from that new arrangement instead of from a zero nobody chose.
--
-- Scoped to salaried people only. An hourly teacher's frozen rate is a real
-- record of what was agreed and must not be touched.

UPDATE "sessions" s
SET "paid_rate" = NULL, "paid_rate_source" = NULL
FROM "classes" c, "users" u
WHERE s."class_id" = c."id"
  AND c."teacher_id" = u."id"
  AND u."base_salary" IS NOT NULL
  AND s."paid_rate" IS NOT NULL
  AND s."paid_rate" > 0;

UPDATE "work_shifts" w
SET "paid_rate" = NULL, "paid_rate_source" = NULL
FROM "users" u
WHERE w."staff_id" = u."id"
  AND u."base_salary" IS NOT NULL
  AND w."paid_rate" IS NOT NULL
  AND w."paid_rate" > 0;
