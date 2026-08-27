-- When an invoice line was written and last touched.
--
-- Without this, an invoice that shows the family the wrong amount cannot be
-- investigated at all: on 2026-08-26 LC-4403 was emailed with three lines at
-- $100 when two of them were $400, and by the time anyone looked the rows were
-- correct with nothing to say who had fixed them or when.
--
-- Backfilled from the invoice, which is the closest true thing available: a
-- line cannot predate the document it sits on.
ALTER TABLE "invoice_lines"
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "invoice_lines" l
   SET "created_at" = i."created_at",
       "updated_at" = i."created_at"
  FROM "invoices" i
 WHERE i."id" = l."invoice_id";
