-- Replies on an announcement. Parents read the feed and had no way to answer
-- in place: an open house went up and the questions came back by text message
-- to whoever's number a family happened to have. This keeps the answer beside
-- the post everyone else is reading.
CREATE TABLE "announcement_comments" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_comments_pkey" PRIMARY KEY ("id")
);

-- The thread is always read whole, oldest first.
CREATE INDEX "announcement_comments_announcement_id_created_at_idx"
    ON "announcement_comments"("announcement_id", "created_at");

-- Deleting the post takes its replies with it; they have no meaning alone.
ALTER TABLE "announcement_comments" ADD CONSTRAINT "announcement_comments_announcement_id_fkey"
    FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE on the author too: unlike a staff action log, a reply is the
-- person's own words on a noticeboard, and a family that leaves takes them.
ALTER TABLE "announcement_comments" ADD CONSTRAINT "announcement_comments_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
