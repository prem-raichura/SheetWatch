-- Per-check cadence for integrity checks, in seconds. Existing rows ran on the
-- old global two-minute sweep; 180 is the nearest value the UI offers
-- (1 / 3 / 5 / 10 min), so every stored value maps onto a real choice.
ALTER TABLE "ComparisonGroup" ADD COLUMN     "checkInterval" INTEGER NOT NULL DEFAULT 180;
