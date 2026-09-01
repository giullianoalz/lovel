-- Wave invoice sync: push each invoice to Wave as Accounts Receivable at
-- creation time, alongside the existing payment-based income sync.

-- Per-invoice sync tracking, mirroring payments.wave_transaction_id/wave_synced_at.
ALTER TABLE "invoices" ADD COLUMN "wave_invoice_id" VARCHAR(255);
ALTER TABLE "invoices" ADD COLUMN "wave_synced_at" TIMESTAMPTZ(6);
ALTER TABLE "invoices" ADD COLUMN "wave_sync_error" TEXT;

-- The one Wave Product every synced invoice line bills against (Wave's
-- invoiceCreate requires a productId per line, not a bare account). Created
-- once on first sync and reused after.
ALTER TABLE "wave_connection" ADD COLUMN "wave_product_id" VARCHAR(255);
