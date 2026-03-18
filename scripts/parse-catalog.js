#!/usr/bin/env node
/**
 * parse-catalog.js
 * Parses UT 2025/2026 curriculum markdown catalogs and generates:
 *   migrations/003_seed_subjects.sql
 *   migrations/004_seed_packages.sql
 *
 * Usage: node scripts/parse-catalog.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

const CATALOG_DIR = path.resolve(__dirname, '../../ut-taiwan/output');
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

const CATALOG_FILES = [
  '01-Katalog-Kurikulum-FEB-FHISIP-FKIP-Non-PGSD-Non-PGPAUD-dan-Non-PAI-FST-UT-2025-2026-10Desember2025.md',
  '02-Katalog-Kurikulum-Program-Studi-PGSD-PGPAUD-dan-PAI-FKIP-UT-2025-2026-07012026.md',
];

// D3/D4 program DB codes (to pick correct default semTargets)
const D3_PROGRAMS = new Set(['60']);
const D4_PROGRAMS = new Set(['65']);

// Catalog "Program Studi" code → DB programs.code
// (catalog code taken from "Program Studi: XX/Name" headers)
const CAT_TO_DB = {
  // FEB
  '53':  '53',   // Ekonomi Pembangunan (S1)
  '458': '54',   // Ekonomi Syariah (S1)
  '54':  '55',   // Manajemen (S1)
  '471': '56',   // Pariwisata (S1)
  '83':  '57',   // Akuntansi (S1)
  '483': '58',   // Akuntansi Keuangan Publik (S1)
  '472': '59',   // Kewirausahaan (S1)
  // FHISIP
  '30':  '60',   // Perpajakan (D-III)
  '312': '61',   // Perpajakan (S1)
  '50':  '62',   // Administrasi Publik (S1)
  '51':  '63',   // Administrasi Bisnis (S1)
  '71':  '64',   // Ilmu Pemerintahan (S1)
  '38':  '65',   // Kearsipan (D-IV)
  '72':  '66',   // Ilmu Komunikasi (S1)
  '310': '67',   // Ilmu Perpustakaan (S1)
  '70':  '68',   // Sosiologi (S1)
  '87':  '69',   // Sastra Inggris (S1)
  '311': '70',   // Ilmu Hukum (S1)
  // FKIP — Prajabatan (Pre-service) versions; skip Dalam Jabatan duplicates
  '57A': '71',   // Pendidikan Bahasa dan Sastra Indonesia (S1)
  '58A': '72',   // Pendidikan Bahasa Inggris (S1)
  '59A': '73',   // Pendidikan Biologi (S1)
  '60A': '74',   // Pendidikan Fisika (S1)
  '61A': '75',   // Pendidikan Kimia (S1)
  '62A': '76',   // Pendidikan Matematika (S1)
  '73A': '77',   // Pendidikan Pancasila dan Kewarganegaraan (S1)
  '76A': '78',   // Pendidikan Ekonomi (S1)
  '163': '79',   // Teknologi Pendidikan (S1)
  // PGSD / PGPAUD / PAI — Pre-service from catalog 2
  '11A': '80',   // PGSD Prajabatan
  '12A': '81',   // PGPAUD Prajabatan
  '152': '82',   // PAI Prajabatan
  // FST
  '55':  '83',   // Matematika (S1)
  '56':  '84',   // Statistika (S1)
  '78':  '85',   // Biologi (S1)
  '279': '86',   // Perencanaan Wilayah dan Kota (S1)
  '252': '87',   // Sistem Informasi (S1)
  '274': '88',   // Agribisnis (S1)
  '84':  '89',   // Teknologi Pangan (S1)
  '253': '90',   // Sains Data (S1)
};

// ─── Regex helpers ──────────────────────────────────────────────────────────

const RE_COURSE_CODE   = /^[A-Z]{2,8}\d{4}[A-Z]?$/;
const RE_MODULE_CODE   = /^[A-Z]{2,8}\d{4}[A-Z]?$/;
const RE_EXAM_PERIOD   = /^[IVX0-9]{1,4}\.\d+$|^99$|^0\.\d+$/;
const RE_PROG_HEADER   = /Program Studi\s*[:：]\s*([A-Z0-9]+)\//;
const RE_TOTAL_SKS     = /Total\s+sks/i;
const RE_ELECTIVE      = /Pilih\s+(salah\s+satu|satu)\b/i;
const RE_PAGE_SEP      = /^---$|^<!--/;
const RE_SEPARATOR     = /^[|:\s-]+$/;

// ─── SQL helpers ─────────────────────────────────────────────────────────────

function esc(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

// ─── Row parsers ─────────────────────────────────────────────────────────────

/**
 * Parse a pipe-delimited subject row.
 * Returns { code, name, sks, examPeriod, moduleCodes[], semColIndex, isRequired, rowNo }
 * or null if not a subject row.
 */
function parsePipeRow(line) {
  if (!line.startsWith('|')) return null;
  const parts = line.split('|').map(s => s.trim());
  // minimum: '' | no | code | name | sks | exam | modcode | modname | ...
  if (parts.length < 8) return null;

  const code = parts[2];
  if (!code || !RE_COURSE_CODE.test(code)) return null;

  const sksRaw = parts[4];
  const sks = parseInt(sksRaw, 10);
  if (!sksRaw || isNaN(sks) || sks <= 0 || sks > 24) return null;

  const examPeriod = parts[5] || null;
  const modCodeRaw = parts[6];

  // Collect all module codes: first at parts[6], then look for additional ones
  const moduleCodes = [];
  if (modCodeRaw && RE_MODULE_CODE.test(modCodeRaw)) moduleCodes.push(modCodeRaw);

  // Check parts[7] and beyond for additional module codes
  // (Some subjects have multiple modules listed in the name column or beyond)
  for (let i = 7; i < Math.min(parts.length, 20); i++) {
    const p = parts[i].trim();
    if (RE_MODULE_CODE.test(p) && !moduleCodes.includes(p)) {
      moduleCodes.push(p);
    }
  }

  // Look for semester value: first purely numeric value in columns [8..15]
  let semColIndex = null; // 0-based offset from column 8 → semester = offset + 1
  for (let i = 8; i <= 15 && i < parts.length; i++) {
    const v = parts[i];
    if (/^\d+$/.test(v) && parseInt(v, 10) > 0) {
      semColIndex = i - 8; // 0 → sem1, 1 → sem2 ...
      break;
    }
  }

  const rowNoStr = parts[1];
  const rowNo = rowNoStr && /^\d+$/.test(rowNoStr) ? parseInt(rowNoStr, 10) : null;

  return {
    code,
    name: parts[3] || code,
    sks,
    examPeriod: examPeriod && (RE_EXAM_PERIOD.test(examPeriod) || /^\d/.test(examPeriod)) ? examPeriod : null,
    moduleCodes,
    semColIndex,  // null if no semester column value found
    isRequired: rowNo !== null,
    rowNo,
    isPipe: true,
  };
}

/**
 * Parse a plain-text subject row (first page of each program section).
 * Returns subject object or null.
 */
function parsePlainRow(line) {
  // Must start with optional row number + course code
  // Pattern: [N] CODE NAME sks EXAM MODCODE MODNAME [semValue] [Ket]
  const m = line.match(
    /^\s*(\d+\s+)?([A-Z]{2,8}\d{4}[A-Z]?)\s+(.+?)\s+(\d{1,2})\s+([IVX0-9]{1,4}\.\d+|99|0\.\d+)\s+([A-Z]{2,8}\d{4}[A-Z]?)\s+/
  );

  if (m) {
    const code = m[2];
    if (!RE_COURSE_CODE.test(code)) return null;

    const name = m[3];
    const sks = parseInt(m[4], 10);
    if (isNaN(sks) || sks <= 0 || sks > 24) return null;

    const examPeriod = m[5];
    const firstModCode = m[6];

    const restOfLine = line.slice(m.index + m[0].length);
    const moduleCodes = [firstModCode];

    const additionalCodes = restOfLine.matchAll(/\b([A-Z]{2,8}\d{4}[A-Z]?)\b/g);
    for (const match of additionalCodes) {
      const c = match[1];
      if (RE_MODULE_CODE.test(c) && !moduleCodes.includes(c)) {
        moduleCodes.push(c);
      }
    }

    const rowNoStr = m[1] ? m[1].trim() : null;
    const rowNo = rowNoStr ? parseInt(rowNoStr, 10) : null;

    return {
      code,
      name,
      sks,
      examPeriod,
      moduleCodes,
      semColIndex: null,
      isRequired: rowNo !== null,
      rowNo,
      isPipe: false,
    };
  }

  // Fallback: no-SKS format (catalog 02 PGSD/PGPAUD/PAI plain-text)
  // Pattern: [N] CODE NAME EXAM MODCODE ...
  const m2 = line.match(
    /^\s*(\d+\s+)?([A-Z]{2,8}\d{4}[A-Z]?)\s+(.+?)\s+([IVX0-9]{1,4}\.\d+|99|0\.\d+)\s+([A-Z]{2,8}\d{4}[A-Z]?)\s+/
  );
  if (!m2) return null;

  const code = m2[2];
  if (!RE_COURSE_CODE.test(code)) return null;

  const name = m2[3];
  const examPeriod = m2[4];
  const firstModCode = m2[5];

  // Try to extract SKS from trailing number before Ket (e.g. "... Kepramukaan 3 BP")
  const sksMatch = line.match(/\s+(\d{1,2})\s+[A-Z]{1,5}[\s,]*$/);
  const sks = sksMatch ? parseInt(sksMatch[1], 10) : 3;

  const restOfLine = line.slice(m2.index + m2[0].length);
  const moduleCodes = [firstModCode];

  const additionalCodes = restOfLine.matchAll(/\b([A-Z]{2,8}\d{4}[A-Z]?)\b/g);
  for (const match of additionalCodes) {
    const c = match[1];
    if (RE_MODULE_CODE.test(c) && !moduleCodes.includes(c)) {
      moduleCodes.push(c);
    }
  }

  const rowNoStr = m2[1] ? m2[1].trim() : null;
  const rowNo = rowNoStr ? parseInt(rowNoStr, 10) : null;

  return {
    code,
    name,
    sks,
    examPeriod,
    moduleCodes,
    semColIndex: null,
    isRequired: rowNo !== null,
    rowNo,
    isPipe: false,
  };
}

/**
 * Check if a line looks like an elective row (no row number, has a course code, starts with spaces/code)
 */
function isElectivePlainRow(line) {
  return /^\s*[A-Z]{2,8}\d{4}[A-Z]?\s/.test(line) && !/^\s*\d+\s/.test(line);
}

/**
 * Parse the Total sks row and return array of per-semester SKS totals.
 */
function parseTotalRow(line) {
  // Extract all numbers; filter for reasonable semester values (5–35)
  const nums = [...line.matchAll(/\b(\d+)\b/g)]
    .map(m => parseInt(m[1], 10))
    .filter(n => n >= 5 && n <= 35);
  // Expect 6 or 8 values (D-III has 6, S1 has 8)
  if (nums.length >= 4) return nums.slice(0, 8);
  return null;
}

// ─── Program parser ──────────────────────────────────────────────────────────

function parseProgram(lines, startIdx) {
  /**
   * Reads from startIdx until the next "Struktur Kurikulum" header or EOF.
   * Returns { subjects[], semesterTargets[] }
   */
  const subjects   = []; // accumulated subject objects
  let semTargets   = null;
  let inElective   = false;
  let electiveSemAssigned = false;

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Stop at next program's "Struktur Kurikulum" header (but not the first one)
    if (i > startIdx && /Struktur Kurikulum/i.test(line)) break;

    // Skip page separators, comments, blank
    if (!line || RE_PAGE_SEP.test(line)) continue;

    // Skip table separator rows
    if (RE_SEPARATOR.test(line)) continue;

    // Detect elective group start
    if (RE_ELECTIVE.test(line)) {
      inElective = true;
      electiveSemAssigned = false;
      continue;
    }

    // Detect Total sks row
    if (RE_TOTAL_SKS.test(line)) {
      const targets = parseTotalRow(line);
      if (targets) semTargets = targets;
      continue;
    }

    // Skip known non-subject lines
    if (/^(Kode|No\.|Keterangan|Waktu|Bahan|Paket|#|BAB |FAKULTAS |PENUTUP|Catatan)/i.test(line)) continue;
    if (/^(CPL|Visi|Misi|Tujuan|Capaian|Struktur|Program Studi|ALAMAT)/i.test(line)) continue;
    if (/^(Kolom|Waktu Ujian 99|Mahasiswa|Program|Pada kolom)/i.test(line)) continue;
    if (/^\*\*/.test(line)) continue;
    if (/^Total sks/.test(line)) continue;

    // Try to parse as pipe row
    let subj = parsePipeRow(line);

    // Try plain-text row if not pipe
    if (!subj) {
      // Check for elective plain-text rows (no number at start)
      if (inElective && isElectivePlainRow(line)) {
        subj = parsePlainRow(line);
        if (subj) subj.isRequired = false;
      } else {
        subj = parsePlainRow(line);
      }
    } else {
      // Pipe row: if no row number, it's an elective
      if (subj.rowNo === null) subj.isRequired = false;
    }

    if (!subj) continue;

    // Once we see a numbered row again after an elective group, exit elective mode
    if (inElective && subj.rowNo !== null) {
      inElective = false;
      electiveSemAssigned = false;
    }

    if (inElective) subj.isRequired = false;

    subjects.push(subj);
  }

  return { subjects, semTargets };
}

// ─── Semester assignment ─────────────────────────────────────────────────────

/**
 * Assign semester_hint to each subject using SKS accumulation.
 * Uses semTargets array (SKS per semester from Total row).
 */
// Default semester targets when Total sks row is missing
const DEFAULT_S1_TARGETS  = [18, 18, 20, 20, 20, 20, 18, 16];
const DEFAULT_D3_TARGETS  = [17, 17, 20, 18, 20, 18];
const DEFAULT_D4_TARGETS  = [16, 20, 18, 17, 20, 20, 19, 15];

function assignSemesters(subjects, semTargets, level) {
  // Use provided targets or fall back to defaults based on program level
  let targets = semTargets;
  if (!targets || targets.length === 0) {
    if (level === 'D3') targets = DEFAULT_D3_TARGETS;
    else if (level === 'D4') targets = DEFAULT_D4_TARGETS;
    else targets = DEFAULT_S1_TARGETS;
  }

  const maxSem = targets.length;
  let currentSem = 1;
  let accumulated = 0;
  let electiveGroupSem = null;
  let firstInElectiveGroup = true;

  for (let i = 0; i < subjects.length; i++) {
    const s = subjects[i];

    if (s.isRequired) {
      // Reset elective tracking when we hit a required (numbered) subject
      electiveGroupSem = null;
      firstInElectiveGroup = true;

      // Cross-check with semColIndex if available and it says a later semester
      if (s.semColIndex !== null) {
        const semFromCol = s.semColIndex + 1;
        if (semFromCol > currentSem && semFromCol <= maxSem) {
          currentSem = semFromCol;
          accumulated = 0;
        }
      }

      s.semester_hint = currentSem;
      accumulated += s.sks;

      // Advance semester if accumulated >= target (with a small tolerance)
      while (currentSem <= maxSem && accumulated >= (targets[currentSem - 1] || 24)) {
        accumulated -= (targets[currentSem - 1] || 24);
        currentSem = Math.min(currentSem + 1, maxSem);
      }
    } else {
      // Elective: assign to current semester; only count first member's SKS
      if (electiveGroupSem === null) {
        electiveGroupSem = currentSem;
      }
      s.semester_hint = electiveGroupSem;

      if (firstInElectiveGroup) {
        firstInElectiveGroup = false;
        accumulated += s.sks;
        // Check if this elective tips the accumulation
        while (currentSem <= maxSem && accumulated >= (targets[currentSem - 1] || 24)) {
          accumulated -= (targets[currentSem - 1] || 24);
          currentSem = Math.min(currentSem + 1, maxSem);
          electiveGroupSem = null; // elective group ended with semester advance
          if (electiveGroupSem === null) electiveGroupSem = currentSem;
        }
      }
    }
  }
}

// ─── Catalog parser ──────────────────────────────────────────────────────────

function parseCatalogFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const programs = {}; // dbCode → { subjects[], semTargets[] }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Detect program header
    const progMatch = line.match(RE_PROG_HEADER);
    if (progMatch) {
      const catCode = progMatch[1];
      const dbCode = CAT_TO_DB[catCode];

      if (dbCode) {
        const level = D3_PROGRAMS.has(dbCode) ? 'D3' : D4_PROGRAMS.has(dbCode) ? 'D4' : 'S1';
        const { subjects, semTargets } = parseProgram(lines, i + 1);
        assignSemesters(subjects, semTargets, level);
        if (subjects.length > 0) {
          programs[dbCode] = { subjects, semTargets };
          console.log(`  Program DB ${dbCode} (cat ${catCode}): ${subjects.length} subjects, sems=${semTargets ? semTargets.join(',') : 'default-' + level}`);
        }
      }
    }

    i++;
  }

  return programs;
}

// ─── SQL generators ──────────────────────────────────────────────────────────

function generateSubjectSQL(allPrograms) {
  const lines = [
    '-- ============================================================',
    '-- 003_seed_subjects.sql',
    '-- Auto-generated by scripts/parse-catalog.js',
    '-- Run AFTER 002_seed_catalog.sql',
    '-- ============================================================',
    '',
  ];

  for (const [dbCode, { subjects }] of Object.entries(allPrograms)) {
    if (subjects.length === 0) continue;

    lines.push(`-- Program ${dbCode} ──────────────────────────────────────────`);

    // Track seen (program_id, code) pairs to deduplicate
    const seen = new Set();

    for (const s of subjects) {
      const key = `${dbCode}:${s.code}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const semHint = s.semester_hint || 1;
      const notes = null;

      lines.push(
        `INSERT INTO subjects (program_id, code, name, sks, exam_period, semester_hint, notes, is_required)` +
        ` SELECT p.id, ${esc(s.code)}, ${esc(s.name)}, ${s.sks}, ${esc(s.examPeriod)}, ${semHint}, ${esc(notes)}, ${s.isRequired}` +
        ` FROM programs p WHERE p.code = ${esc(dbCode)}` +
        ` ON CONFLICT (program_id, code) DO NOTHING;`
      );
    }

    lines.push('');

    // Subject → module links
    const seenLinks = new Set();
    for (const s of subjects) {
      if (s.moduleCodes.length === 0) continue;
      const key = `${dbCode}:${s.code}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);

      for (const modCode of s.moduleCodes) {
        lines.push(
          `INSERT INTO subject_modules (subject_id, module_id)` +
          ` SELECT s.id, m.id` +
          ` FROM subjects s` +
          ` JOIN programs p ON s.program_id = p.id` +
          ` JOIN modules m ON REGEXP_REPLACE(m.tbo_code, '-\\\\d+$', '') = ${esc(modCode)}` +
          ` WHERE p.code = ${esc(dbCode)} AND s.code = ${esc(s.code)}` +
          ` ON CONFLICT (subject_id, module_id) DO NOTHING;`
        );
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function generatePackageSQL(allPrograms) {
  const lines = [
    '-- ============================================================',
    '-- 004_seed_packages.sql',
    '-- Auto-generated by scripts/parse-catalog.js',
    '-- Run AFTER 003_seed_subjects.sql AND after scraper has run',
    '-- ============================================================',
    '',
    '-- Helper: add unique constraint on packages if not exists',
    '-- (safe to run multiple times)',
    `DO $$ BEGIN`,
    `  IF NOT EXISTS (`,
    `    SELECT 1 FROM pg_constraint WHERE conname = 'packages_program_id_semester_key'`,
    `  ) THEN`,
    `    ALTER TABLE packages ADD CONSTRAINT packages_program_id_semester_key UNIQUE (program_id, semester);`,
    `  END IF;`,
    `END $$;`,
    '',
  ];

  for (const [dbCode, { subjects, semTargets }] of Object.entries(allPrograms)) {
    if (subjects.length === 0) continue;

    // Determine distinct semesters present
    const semesters = [...new Set(subjects.map(s => s.semester_hint).filter(Boolean))].sort((a, b) => a - b);
    if (semesters.length === 0) continue;

    lines.push(`-- Packages for program ${dbCode} ────────────────────────────────`);

    for (const sem of semesters) {
      // Insert package
      lines.push(
        `INSERT INTO packages (program_id, name, description, semester, is_active)` +
        ` SELECT p.id,` +
        `  'Paket Semester ${sem} \u2014 ' || p.name,` +
        `  'Paket bahan ajar semester ${sem} Program Studi ' || p.name,` +
        `  ${sem}, true` +
        ` FROM programs p WHERE p.code = ${esc(dbCode)}` +
        ` ON CONFLICT (program_id, semester) DO NOTHING;`
      );
    }

    lines.push('');

    // Insert package_modules for each semester
    for (const sem of semesters) {
      lines.push(
        `-- Package modules: program ${dbCode} semester ${sem}`,
        `INSERT INTO package_modules (package_id, module_id, sort_order)`,
        `SELECT pk.id, m.id,`,
        `  ROW_NUMBER() OVER (PARTITION BY pk.id ORDER BY s.code)::int`,
        `FROM packages pk`,
        `JOIN programs p ON pk.program_id = p.id`,
        `JOIN subjects s ON s.program_id = p.id AND s.semester_hint = pk.semester`,
        `JOIN subject_modules sm ON sm.subject_id = s.id`,
        `JOIN modules m ON m.id = sm.module_id`,
        `WHERE p.code = ${esc(dbCode)} AND pk.semester = ${sem}`,
        `ON CONFLICT (package_id, module_id) DO NOTHING;`,
        ''
      );
    }
  }

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('Parsing UT 2025/2026 curriculum catalogs...\n');

  const allPrograms = {};

  for (const filename of CATALOG_FILES) {
    const filePath = path.join(CATALOG_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`  WARNING: file not found: ${filePath}`);
      continue;
    }
    console.log(`\nParsing: ${filename}`);
    const programs = parseCatalogFile(filePath);
    Object.assign(allPrograms, programs);
  }

  console.log(`\nTotal programs parsed: ${Object.keys(allPrograms).length}`);
  console.log(`Total subjects: ${Object.values(allPrograms).reduce((sum, p) => sum + p.subjects.length, 0)}`);

  // Write migrations
  fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });

  const sql003 = generateSubjectSQL(allPrograms);
  const sql004 = generatePackageSQL(allPrograms);

  const out003 = path.join(MIGRATIONS_DIR, '003_seed_subjects.sql');
  const out004 = path.join(MIGRATIONS_DIR, '004_seed_packages.sql');

  fs.writeFileSync(out003, sql003, 'utf8');
  fs.writeFileSync(out004, sql004, 'utf8');

  console.log(`\nGenerated:`);
  console.log(`  ${out003}  (${(sql003.length / 1024).toFixed(1)} KB)`);
  console.log(`  ${out004}  (${(sql004.length / 1024).toFixed(1)} KB)`);
  console.log('\nDone.');
}

main();
