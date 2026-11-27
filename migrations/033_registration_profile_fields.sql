-- Additive only: existing students keep their current data and may fill these later.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_taiwan VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS almamater_size VARCHAR(30);
COMMIT;
