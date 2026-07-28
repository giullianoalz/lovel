-- Per-class price. Nullable and with no default, so every existing class keeps
-- pricing off its term's regular/anchored rate exactly as before; only classes
-- that get an explicit value change behaviour.
ALTER TABLE "classes" ADD COLUMN "price_override" DECIMAL(10,2);
