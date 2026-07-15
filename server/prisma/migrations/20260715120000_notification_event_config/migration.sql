-- The single-row academy_settings table is superseded by a per-event config
-- table. Its three columns were only the class-reminder and absence toggles,
-- which are re-created (with richer control) as NotificationEventConfig rows.
-- Dropping it resets those toggles to their catalog defaults (all enabled).
DROP TABLE IF EXISTS "academy_settings";

-- CreateTable
CREATE TABLE "notification_event_config" (
    "id" UUID NOT NULL,
    "event_key" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "audience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "params" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "notification_event_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_config_event_key_key" ON "notification_event_config"("event_key");
