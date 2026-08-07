-- The signed liability waiver, one row per child. The names and the waiver
-- version are snapshotted rather than joined: this is a legal record of what
-- the parent agreed to at that moment, and a later rename of the account must
-- not rewrite a signed document.

CREATE TABLE "liability_waivers" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "signed_by_id" UUID NOT NULL,
    "minor_name" VARCHAR(255) NOT NULL,
    "parent_name" VARCHAR(255) NOT NULL,
    "signature_data" TEXT NOT NULL,
    "document_version" VARCHAR(20) NOT NULL DEFAULT '2026-08',
    "ip_address" VARCHAR(64),
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liability_waivers_pkey" PRIMARY KEY ("id")
);

-- One waiver per child: the constraint, not the application, is what stops a
-- second signature from quietly replacing the first.
CREATE UNIQUE INDEX "liability_waivers_student_id_key" ON "liability_waivers"("student_id");
CREATE INDEX "liability_waivers_family_id_idx" ON "liability_waivers"("family_id");

ALTER TABLE "liability_waivers" ADD CONSTRAINT "liability_waivers_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "liability_waivers" ADD CONSTRAINT "liability_waivers_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "liability_waivers" ADD CONSTRAINT "liability_waivers_signed_by_id_fkey"
    FOREIGN KEY ("signed_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
