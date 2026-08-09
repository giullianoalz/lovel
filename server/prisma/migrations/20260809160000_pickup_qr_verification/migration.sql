-- Tie a pickup authorisation to the child it releases, so the front desk can
-- scan the QR and know who is being collected. Nullable: the portal offers
-- "All children" for a family, and the rows written before this never recorded
-- a child at all.
ALTER TABLE "temp_pickup_auths" ADD COLUMN "student_id" UUID;
ALTER TABLE "temp_pickup_auths" ADD COLUMN "relationship" VARCHAR(100);

ALTER TABLE "temp_pickup_auths"
  ADD CONSTRAINT "temp_pickup_auths_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "temp_pickup_auths_student_id_idx" ON "temp_pickup_auths"("student_id");

-- Who the child was handed to, recorded at check-out.
ALTER TABLE "attendance" ADD COLUMN "checked_out_to" VARCHAR(255);
