-- ============================================================
-- Seed: Faculties & Programs (from 2025/2026 catalog)
-- ============================================================

-- Faculties
INSERT INTO faculties (code, name, description) VALUES
  ('FEB', 'Fakultas Ekonomi dan Bisnis', 'Menyelenggarakan pendidikan tinggi bidang ekonomi dan bisnis'),
  ('FHISIP', 'Fakultas Hukum, Ilmu Sosial, dan Ilmu Politik', 'Menyelenggarakan pendidikan tinggi bidang hukum, ilmu sosial, dan ilmu politik'),
  ('FKIP', 'Fakultas Keguruan dan Ilmu Pendidikan', 'Menyelenggarakan pendidikan tinggi bidang keguruan dan ilmu pendidikan'),
  ('FST', 'Fakultas Sains dan Teknologi', 'Menyelenggarakan pendidikan tinggi bidang sains dan teknologi')
ON CONFLICT (code) DO NOTHING;

-- Programs — FEB
INSERT INTO programs (faculty_id, code, name, level, total_sks)
SELECT f.id, p.code, p.name, p.level, p.total_sks
FROM faculties f, (VALUES
  ('53', 'Ekonomi Pembangunan (S1)', 'S1', 144),
  ('54', 'Ekonomi Syariah (S1)', 'S1', 144),
  ('55', 'Manajemen (S1)', 'S1', 144),
  ('56', 'Pariwisata (S1)', 'S1', 144),
  ('57', 'Akuntansi (S1)', 'S1', 144),
  ('58', 'Akuntansi Keuangan Publik (S1)', 'S1', 144),
  ('59', 'Kewirausahaan (S1)', 'S1', 144)
) AS p(code, name, level, total_sks)
WHERE f.code = 'FEB'
ON CONFLICT (code) DO NOTHING;

-- Programs — FHISIP
INSERT INTO programs (faculty_id, code, name, level, total_sks)
SELECT f.id, p.code, p.name, p.level, p.total_sks
FROM faculties f, (VALUES
  ('60', 'Perpajakan (D-III)', 'D3', 110),
  ('61', 'Perpajakan (S1)', 'S1', 144),
  ('62', 'Administrasi Publik (S1)', 'S1', 144),
  ('63', 'Administrasi Bisnis (S1)', 'S1', 144),
  ('64', 'Ilmu Pemerintahan (S1)', 'S1', 144),
  ('65', 'Kearsipan (D-IV)', 'D4', 144),
  ('66', 'Ilmu Komunikasi (S1)', 'S1', 144),
  ('67', 'Ilmu Perpustakaan (S1)', 'S1', 144),
  ('68', 'Sosiologi (S1)', 'S1', 144),
  ('69', 'Sastra Inggris (S1)', 'S1', 144),
  ('70', 'Ilmu Hukum (S1)', 'S1', 144)
) AS p(code, name, level, total_sks)
WHERE f.code = 'FHISIP'
ON CONFLICT (code) DO NOTHING;

-- Programs — FKIP
INSERT INTO programs (faculty_id, code, name, level, total_sks)
SELECT f.id, p.code, p.name, p.level, p.total_sks
FROM faculties f, (VALUES
  ('71', 'Pendidikan Bahasa dan Sastra Indonesia (S1)', 'S1', 144),
  ('72', 'Pendidikan Bahasa Inggris (S1)', 'S1', 144),
  ('73', 'Pendidikan Biologi (S1)', 'S1', 144),
  ('74', 'Pendidikan Fisika (S1)', 'S1', 144),
  ('75', 'Pendidikan Kimia (S1)', 'S1', 144),
  ('76', 'Pendidikan Matematika (S1)', 'S1', 144),
  ('77', 'Pendidikan Pancasila dan Kewarganegaraan (S1)', 'S1', 144),
  ('78', 'Pendidikan Ekonomi (S1)', 'S1', 144),
  ('79', 'Teknologi Pendidikan (S1)', 'S1', 144),
  ('80', 'Pendidikan Guru Sekolah Dasar (S1)', 'S1', 144),
  ('81', 'Pendidikan Guru Pendidikan Anak Usia Dini (S1)', 'S1', 144),
  ('82', 'Pendidikan Agama Islam (S1)', 'S1', 144)
) AS p(code, name, level, total_sks)
WHERE f.code = 'FKIP'
ON CONFLICT (code) DO NOTHING;

-- Programs — FST
INSERT INTO programs (faculty_id, code, name, level, total_sks)
SELECT f.id, p.code, p.name, p.level, p.total_sks
FROM faculties f, (VALUES
  ('83', 'Matematika (S1)', 'S1', 144),
  ('84', 'Statistika (S1)', 'S1', 144),
  ('85', 'Biologi (S1)', 'S1', 144),
  ('86', 'Perencanaan Wilayah dan Kota (S1)', 'S1', 144),
  ('87', 'Sistem Informasi (S1)', 'S1', 144),
  ('88', 'Agribisnis (S1)', 'S1', 144),
  ('89', 'Teknologi Pangan (S1)', 'S1', 144),
  ('90', 'Sains Data (S1)', 'S1', 144)
) AS p(code, name, level, total_sks)
WHERE f.code = 'FST'
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Sample subjects for Ekonomi Pembangunan (S1) — Semester 1
-- Source: Catalog page 17-18
-- ============================================================
INSERT INTO subjects (program_id, code, name, sks, exam_period, semester_hint, is_required)
SELECT p.id, s.code, s.name, s.sks, s.exam_period, s.semester_hint, true
FROM programs p, (VALUES
  ('ECON4103', 'Matematika Ekonomi', 3, 'I.1', 1),
  ('MKWN4110', 'Pancasila', 2, 'I.3', 1),
  ('ECON4101', 'Pengantar Ekonomi Makro', 3, 'II.2', 1),
  ('ECON4102', 'Pengantar Ekonomi Mikro', 3, 'II.4', 1),
  ('EMBS4101', 'Manajemen', 4, 'II.5', 1),
  ('MKWN4108', 'Bahasa Indonesia', 2, 'II.3', 2),
  ('MKWN4109', 'Pendidikan Kewarganegaraan', 2, 'II.4', 2),
  ('ECON4113', 'Matematika Ekonomi dan Bisnis', 3, 'I.1', 2),
  ('EACC4101', 'Pengantar Akuntansi', 4, 'I.2', 2),
  ('MKKI4201', 'Pengantar Statistik', 3, 'II.1', 2),
  ('ECON4112', 'Teori Ekonomi Mikro', 4, 'II.5', 3),
  ('ECON4207', 'Ekonomi Pembangunan', 3, 'I.2', 3),
  ('ECON4204', 'Statistika Ekonomi dan Bisnis', 3, 'I.3', 3),
  ('ECON4211', 'Teori Ekonomi Makro', 4, 'II.1', 3),
  ('MKDI4201', 'Bahasa Inggris', 3, 'II.2', 3),
  ('ECON4215', 'Ekonomi Moneter', 3, 'II.4', 3)
) AS s(code, name, sks, exam_period, semester_hint)
WHERE p.code = '53'
ON CONFLICT (program_id, code) DO NOTHING;

-- ============================================================
-- Sample modules for those subjects
-- (These will be overwritten by the scraper on first run)
-- ============================================================
INSERT INTO modules (tbo_code, name, edition, publisher, is_available) VALUES
  ('ESPA4122', 'Matematika Ekonomi', 'Edisi 3', 'Universitas Terbuka', true),
  ('MKWN4110', 'Pancasila', NULL, 'Universitas Terbuka', true),
  ('ESPA4110', 'Pengantar Ekonomi Makro', 'Edisi 4', 'Universitas Terbuka', true),
  ('ESPA4111', 'Pengantar Ekonomi Mikro', 'Edisi 3', 'Universitas Terbuka', true),
  ('EKMA4116', 'Manajemen', 'Edisi 3', 'Universitas Terbuka', true),
  ('MKWU4108', 'Bahasa Indonesia', 'Edisi 2', 'Universitas Terbuka', true),
  ('MKDU4111', 'Pendidikan Kewarganegaraan', 'Edisi 3', 'Universitas Terbuka', true),
  ('ESPA4222', 'Matematika Ekonomi dan Bisnis', 'Edisi 3', 'Universitas Terbuka', true),
  ('EKMA4115', 'Pengantar Akuntansi', 'Edisi 3', 'Universitas Terbuka', true),
  ('SATS4121', 'Metode Statistik 1', 'Edisi 3', 'Universitas Terbuka', true),
  ('ESPA4221', 'Teori Ekonomi Mikro', 'Edisi 3', 'Universitas Terbuka', true),
  ('ESPA4229', 'Ekonomi Pembangunan', 'Edisi 3', 'Universitas Terbuka', true),
  ('ESPA4224', 'Statistika Ekonomi dan Bisnis', 'Edisi 3', 'Universitas Terbuka', true),
  ('ESPA4220', 'Teori Ekonomi Makro', 'Edisi 3', 'Universitas Terbuka', true),
  ('MKWI4201', 'Bahasa Inggris', 'Edisi 2', 'Universitas Terbuka', true),
  ('ESPA4227', 'Ekonomi Moneter', 'Edisi 3', 'Universitas Terbuka', true)
ON CONFLICT (tbo_code) DO NOTHING;

-- Link subjects to modules for Ekonomi Pembangunan
INSERT INTO subject_modules (subject_id, module_id)
SELECT s.id, m.id FROM subjects s, modules m WHERE (s.code, m.tbo_code) IN (
  ('ECON4103', 'ESPA4122'),
  ('MKWN4110', 'MKWN4110'),
  ('ECON4101', 'ESPA4110'),
  ('ECON4102', 'ESPA4111'),
  ('EMBS4101', 'EKMA4116'),
  ('MKWN4108', 'MKWU4108'),
  ('MKWN4109', 'MKDU4111'),
  ('ECON4113', 'ESPA4222'),
  ('EACC4101', 'EKMA4115'),
  ('MKKI4201', 'SATS4121'),
  ('ECON4112', 'ESPA4221'),
  ('ECON4207', 'ESPA4229'),
  ('ECON4204', 'ESPA4224'),
  ('ECON4211', 'ESPA4220'),
  ('MKDI4201', 'MKWI4201'),
  ('ECON4215', 'ESPA4227')
)
ON CONFLICT (subject_id, module_id) DO NOTHING;
