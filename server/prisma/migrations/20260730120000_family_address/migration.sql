-- Residential address collected on the registration form. Stored on the family
-- because siblings share a household.
-- Nullable and additive: existing rows read as "not recorded yet".
ALTER TABLE "families" ADD COLUMN "address" TEXT;
