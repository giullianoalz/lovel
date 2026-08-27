-- When the invoice was last emailed to the family. Null means it has never
-- been sent. Distinct from `status = SENT`, which stops being true as soon as
-- a payment moves the invoice to PARTIAL/PAID.
ALTER TABLE "invoices" ADD COLUMN "sent_at" TIMESTAMPTZ(6);
