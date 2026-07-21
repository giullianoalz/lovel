-- Per-event delivery channels (IN_APP / EMAIL / SMS). An empty array means
-- "use the catalog default" in server/src/config/notificationEvents.js, so
-- existing rows keep behaving exactly as before this migration.
ALTER TABLE "notification_event_config"
  ADD COLUMN "channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
