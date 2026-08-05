-- Long-lived invite handle. Additive and nullable: every existing row keeps
-- working, and a NULL hash simply means "no invite outstanding".
ALTER TABLE "users" ADD COLUMN "invite_token_hash" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "invite_token_expires_at" TIMESTAMPTZ(6);

-- Unique so redeeming can look the token up directly. Postgres treats NULLs as
-- distinct, so the many rows with no outstanding invite don't collide.
CREATE UNIQUE INDEX "users_invite_token_hash_key" ON "users"("invite_token_hash");
