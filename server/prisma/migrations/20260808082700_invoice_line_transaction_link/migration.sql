-- Links each invoice line to the ledger transaction it was raised from, so an
-- invoice can be edited (or a single line removed) without guessing which
-- transaction a line corresponds to.
ALTER TABLE "invoice_lines" ADD COLUMN "transaction_id" UUID;

CREATE UNIQUE INDEX "invoice_lines_transaction_id_key" ON "invoice_lines"("transaction_id");

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
