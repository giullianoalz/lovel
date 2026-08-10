-- Release the hours that were frozen at "no rate".
--
-- The previous migration stamped a rate onto every confirmed hour, including
-- the ones that resolved to nothing because the person has no rate set at all.
-- That is the wrong thing to preserve: an unpriced hour isn't a contract, it's
-- a gap, and freezing it pins the hour at $0 for good — so the very common
-- order of work (mark the classes complete, then set the rates) would quietly
-- cost somebody their pay.
--
-- Cleared here, and no longer written at all — freezeSessionRates and
-- freezeShiftRates now skip an 'unset' result. These hours price live again and
-- fix themselves the moment a rate exists.

UPDATE "sessions"
SET "paid_rate" = NULL, "paid_rate_source" = NULL
WHERE "paid_rate_source" = 'unset';

UPDATE "work_shifts"
SET "paid_rate" = NULL, "paid_rate_source" = NULL
WHERE "paid_rate_source" = 'unset';
