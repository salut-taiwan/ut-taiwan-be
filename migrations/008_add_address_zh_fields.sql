ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address_zh_city     TEXT,
  ADD COLUMN IF NOT EXISTS address_zh_district TEXT,
  ADD COLUMN IF NOT EXISTS address_zh_road     TEXT,
  ADD COLUMN IF NOT EXISTS address_zh_number   TEXT,
  ADD COLUMN IF NOT EXISTS address_zh_floor    TEXT;