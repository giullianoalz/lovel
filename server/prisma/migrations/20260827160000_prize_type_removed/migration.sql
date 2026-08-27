-- Seashells can now come off a balance without a prize changing hands: a
-- miscounted award, a shell handed to the wrong student, or a behaviour
-- correction. `redeemed` already means "the student got something for these",
-- so a removal needs its own value rather than borrowing that one and lying
-- about what happened.
ALTER TYPE "prize_type" ADD VALUE IF NOT EXISTS 'removed';
