-- The household's standing check-in QR: one code per family, no expiry, shown
-- at the door on arrival and again at pickup. Nullable because it is minted the
-- first time a portal asks for it — the families already imported keep working
-- until someone opens their portal.
ALTER TABLE "families" ADD COLUMN "check_in_code" VARCHAR(64);

CREATE UNIQUE INDEX "families_check_in_code_key" ON "families"("check_in_code");
