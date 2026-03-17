-- ============================================================
-- UT Taiwan Module Matcher — Initial Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Faculties
CREATE TABLE IF NOT EXISTS faculties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Programs (Program Studi)
CREATE TABLE IF NOT EXISTS programs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id  UUID REFERENCES faculties(id) ON DELETE CASCADE,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  level       VARCHAR(10) NOT NULL CHECK (level IN ('D3', 'D4', 'S1')),
  total_sks   INT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. Subjects (Mata Kuliah)
CREATE TABLE IF NOT EXISTS subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    UUID REFERENCES programs(id) ON DELETE CASCADE,
  code          VARCHAR(20) NOT NULL,
  name          TEXT NOT NULL,
  sks           INT NOT NULL,
  exam_period   VARCHAR(10),
  semester_hint INT CHECK (semester_hint BETWEEN 1 AND 9),
  notes         TEXT,
  is_required   BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(program_id, code)
);

-- 4. Modules / Bahan Ajar (scraped from TBO Karunika)
CREATE TABLE IF NOT EXISTS modules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tbo_code        VARCHAR(30) UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  edition         VARCHAR(20),
  author          TEXT,
  publisher       TEXT DEFAULT 'Universitas Terbuka',
  cover_image_url TEXT,
  price_student   NUMERIC(12,2),
  price_general   NUMERIC(12,2),
  weight_grams    INT,
  is_available    BOOLEAN DEFAULT true,
  tbo_url         TEXT,
  has_multimedia  BOOLEAN DEFAULT false,
  first_seen_at   TIMESTAMPTZ DEFAULT now(),
  last_seen_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 5. Subject ↔ Module mapping
CREATE TABLE IF NOT EXISTS subject_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  UUID REFERENCES subjects(id) ON DELETE CASCADE,
  module_id   UUID REFERENCES modules(id) ON DELETE CASCADE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_id, module_id)
);

-- 6. Packages (pre-curated semester bundles)
CREATE TABLE IF NOT EXISTS packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID REFERENCES programs(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  semester    INT CHECK (semester BETWEEN 1 AND 9),
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 7. Package ↔ Module mapping
CREATE TABLE IF NOT EXISTS package_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  UUID REFERENCES packages(id) ON DELETE CASCADE,
  module_id   UUID REFERENCES modules(id) ON DELETE CASCADE,
  sort_order  INT DEFAULT 0,
  UNIQUE(package_id, module_id)
);

-- 8. Scraper Run Logs
CREATE TABLE IF NOT EXISTS scraper_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  modules_added   INT DEFAULT 0,
  modules_updated INT DEFAULT 0,
  modules_removed INT DEFAULT 0,
  error_message   TEXT,
  triggered_by    VARCHAR(20) DEFAULT 'cron' CHECK (triggered_by IN ('cron', 'manual'))
);

-- 9. Module Change History
CREATE TABLE IF NOT EXISTS module_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id       UUID REFERENCES modules(id) ON DELETE CASCADE,
  scraper_run_id  UUID REFERENCES scraper_runs(id),
  change_type     VARCHAR(20) NOT NULL CHECK (change_type IN ('added', 'updated', 'removed')),
  old_data        JSONB,
  new_data        JSONB,
  changed_at      TIMESTAMPTZ DEFAULT now()
);

-- 10. Users (Students) — extends Supabase auth.users
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  nim              VARCHAR(20),
  phone            TEXT,
  program_id       UUID REFERENCES programs(id) ON DELETE SET NULL,
  current_semester INT CHECK (current_semester BETWEEN 1 AND 9),
  shipping_address TEXT,
  city             TEXT,
  province         TEXT,
  postal_code      VARCHAR(10),
  country          TEXT DEFAULT 'Taiwan',
  role             VARCHAR(20) DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  is_verified      BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- 11. Carts (one active cart per user)
CREATE TABLE IF NOT EXISTS carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- 12. Cart Items
CREATE TABLE IF NOT EXISTS cart_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id        UUID REFERENCES carts(id) ON DELETE CASCADE,
  module_id      UUID REFERENCES modules(id) ON DELETE CASCADE,
  quantity       INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_snapshot NUMERIC(12,2) NOT NULL,
  added_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cart_id, module_id)
);

-- 13. Orders
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      VARCHAR(30) UNIQUE NOT NULL,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  status            VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','processing','shipped','delivered','cancelled')),
  subtotal          NUMERIC(12,2) NOT NULL,
  shipping_cost     NUMERIC(12,2) DEFAULT 0,
  total_amount      NUMERIC(12,2) NOT NULL,
  shipping_name     TEXT,
  shipping_address  TEXT,
  shipping_city     TEXT,
  shipping_province TEXT,
  shipping_postal   VARCHAR(10),
  shipping_country  TEXT,
  shipping_phone    TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 14. Order Items
CREATE TABLE IF NOT EXISTS order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID REFERENCES orders(id) ON DELETE CASCADE,
  module_id   UUID REFERENCES modules(id) ON DELETE SET NULL,
  module_code VARCHAR(30) NOT NULL,
  module_name TEXT NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  unit_price  NUMERIC(12,2) NOT NULL,
  subtotal    NUMERIC(12,2) NOT NULL
);

-- 15. Payments
CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID REFERENCES orders(id) ON DELETE CASCADE,
  gateway             VARCHAR(30) CHECK (gateway IN ('midtrans', 'xendit', 'manual')),
  gateway_payment_id  TEXT,
  gateway_billing_no  TEXT,
  method              VARCHAR(30),
  bank                VARCHAR(20),
  amount              NUMERIC(12,2) NOT NULL,
  status              VARCHAR(20) DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','expired','failed','refunded')),
  paid_at             TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  gateway_response    JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_programs_faculty_id ON programs(faculty_id);
CREATE INDEX IF NOT EXISTS idx_subjects_program_id ON subjects(program_id);
CREATE INDEX IF NOT EXISTS idx_subjects_semester_hint ON subjects(semester_hint);
CREATE INDEX IF NOT EXISTS idx_subject_modules_subject_id ON subject_modules(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_modules_module_id ON subject_modules(module_id);
CREATE INDEX IF NOT EXISTS idx_package_modules_package_id ON package_modules(package_id);
CREATE INDEX IF NOT EXISTS idx_modules_tbo_code ON modules(tbo_code);
CREATE INDEX IF NOT EXISTS idx_modules_is_available ON modules(is_available);
CREATE INDEX IF NOT EXISTS idx_modules_deleted_at ON modules(deleted_at);
CREATE INDEX IF NOT EXISTS idx_module_history_module_id ON module_history(module_id);
CREATE INDEX IF NOT EXISTS idx_module_history_run_id ON module_history(scraper_run_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_payment_id ON payments(gateway_payment_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Reference tables: public read
ALTER TABLE faculties ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read faculties" ON faculties FOR SELECT USING (true);
CREATE POLICY "Public read programs" ON programs FOR SELECT USING (true);
CREATE POLICY "Public read subjects" ON subjects FOR SELECT USING (true);
CREATE POLICY "Public read modules" ON modules FOR SELECT USING (true);
CREATE POLICY "Public read packages" ON packages FOR SELECT USING (is_active = true);
CREATE POLICY "Public read subject_modules" ON subject_modules FOR SELECT USING (true);
CREATE POLICY "Public read package_modules" ON package_modules FOR SELECT USING (true);

-- Users: own row only
CREATE POLICY "Users read own profile" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON users FOR UPDATE USING (auth.uid() = id);

-- Carts: own cart only
CREATE POLICY "Users manage own cart" ON carts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own cart items" ON cart_items FOR ALL
  USING (cart_id IN (SELECT id FROM carts WHERE user_id = auth.uid()));

-- Orders: own orders only
CREATE POLICY "Users read own orders" ON orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own order items" ON order_items FOR SELECT
  USING (order_id IN (SELECT id FROM orders WHERE user_id = auth.uid()));
CREATE POLICY "Users read own payments" ON payments FOR SELECT
  USING (order_id IN (SELECT id FROM orders WHERE user_id = auth.uid()));

-- ============================================================
-- REALTIME (enable on orders for live status updates)
-- ============================================================
-- Run this separately if needed:
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
