-- Real date of birth for students. The directory only had `age`, a plain
-- integer that goes stale every year and carries no actual birth date.
-- Nullable and additive: existing rows read as "not recorded yet".
ALTER TABLE "users" ADD COLUMN "birthday" DATE;
