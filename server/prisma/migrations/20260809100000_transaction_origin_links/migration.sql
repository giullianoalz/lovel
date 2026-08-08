-- Links a ledger charge back to what produced it, so the UI can offer to edit
-- that source rather than the bare transaction.
--
-- Recurring charges (recurring_charge_id), quarterly tuition (term_id +
-- quarter) and registration deposits (term_id alone) already carried such a
-- link. These two are the gaps: a cancellation/no-show fee only had its reason
-- spelled out in a description string, and a snack reload pointed at its
-- transaction one-way, which Prisma cannot traverse from the transaction side.
ALTER TABLE "transactions" ADD COLUMN "session_cancellation_id" UUID;

CREATE INDEX "transactions_session_cancellation_id_idx" ON "transactions"("session_cancellation_id");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_session_cancellation_id_fkey"
  FOREIGN KEY ("session_cancellation_id") REFERENCES "session_cancellations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- transaction_id already exists on snack_reload_requests; it just was never a
-- real relation. One reload raises at most one charge, hence UNIQUE.
CREATE UNIQUE INDEX "snack_reload_requests_transaction_id_key" ON "snack_reload_requests"("transaction_id");

ALTER TABLE "snack_reload_requests" ADD CONSTRAINT "snack_reload_requests_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
