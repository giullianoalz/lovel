-- Front desk check-out stamp. Nullable: every existing attendance row predates
-- the desk recording departures, and a null must keep meaning "not signed out"
-- rather than backfilling a departure nobody witnessed.
ALTER TABLE "attendance" ADD COLUMN "checked_out_at" TIMESTAMPTZ(6);
