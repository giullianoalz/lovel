-- Wave accounting integration.

-- Per-payment sync tracking so a re-sync never double-posts income to Wave.
ALTER TABLE "payments" ADD COLUMN "wave_transaction_id" VARCHAR(255);
ALTER TABLE "payments" ADD COLUMN "wave_synced_at" TIMESTAMPTZ(6);
CREATE INDEX "payments_wave_synced_at_idx" ON "payments"("wave_synced_at");

-- Single-row OAuth connection + account mapping to the academy's Wave business.
CREATE TABLE "wave_connection" (
    "id" UUID NOT NULL,
    "business_id" VARCHAR(255),
    "business_name" VARCHAR(255),
    "access_token" TEXT,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMPTZ(6),
    "scope" VARCHAR(255),
    "anchor_account_id" VARCHAR(255),
    "anchor_account_name" VARCHAR(255),
    "income_account_id" VARCHAR(255),
    "income_account_name" VARCHAR(255),
    "connected_by" UUID,
    "connected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wave_connection_pkey" PRIMARY KEY ("id")
);
