'use strict';

/**
 * Seed a database for the acceptance suite.
 *
 * Creates the accounts and catalogue the browser tests expect, and nothing
 * else. Idempotent: run it as often as you like, on a fresh stack or a warm
 * one. It refuses to touch a database that looks like production.
 *
 * Usage:
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   node scripts/seed-e2e.js
 *
 * Accounts (password for all three: E2E_PASSWORD, default 'e2e-password-123'):
 *   student@e2e.test  — verified, not a member, semester 3
 *   member@e2e.test   — active SALUT member, semester 1 (can claim the almet)
 *   admin@e2e.test    — admin
 */

const postgres = require('postgres');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-password-123';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL are all required');
  process.exit(1);
}

// Seeding writes fabricated orders and members. Getting that wrong on the real
// project would be unrecoverable, so refuse anything that is not obviously a
// local or explicitly-marked test target.
const looksLocal = /(^|@|\/\/)(127\.0\.0\.1|localhost|host\.docker\.internal)/.test(SUPABASE_URL);
if (!looksLocal && process.env.E2E_SEED_ALLOW_REMOTE !== 'yes-i-am-sure') {
  console.error(
    `Refusing to seed a non-local target: ${SUPABASE_URL}\n` +
    'This writes fake orders and members. If you truly mean it, set ' +
    'E2E_SEED_ALLOW_REMOTE=yes-i-am-sure',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sql = postgres(DATABASE_URL, { prepare: false, onnotice: () => {} });

const ACCOUNTS = [
  {
    email: 'student@e2e.test',
    name: 'Budi Santoso',
    role: 'student',
    current_semester: 3,
    is_salut: false,
    salut_status: 'none',
    salut_approved_at: null,
  },
  {
    email: 'member@e2e.test',
    name: 'Sari Anggota',
    role: 'student',
    current_semester: 1,
    is_salut: true,
    salut_status: 'approved',
    // Inside the current cycle, so the membership reads as active.
    salut_approved_at: new Date(),
  },
  {
    email: 'admin@e2e.test',
    name: 'Admin SALUT',
    role: 'admin',
    current_semester: 1,
    is_salut: false,
    salut_status: 'none',
    salut_approved_at: null,
  },
];

/** Create the auth user if absent, and return its id either way. */
async function ensureAuthUser(email) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users?.find(u => u.email === email);
  if (existing) {
    // Keep the password predictable even if a previous run used another one.
    await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create ${email}: ${error.message}`);
  return data.user.id;
}

async function seedAccounts(programId) {
  const ids = {};
  for (const account of ACCOUNTS) {
    const id = await ensureAuthUser(account.email);
    ids[account.email] = id;

    await sql`
      INSERT INTO users (id, email, name, nim, phone, role, is_verified, program_id,
                         current_semester, is_salut, salut_status, salut_approved_at,
                         address_zh_city, address_zh_district, address_zh_road,
                         address_zh_number, postal_code, country)
      VALUES (${id}, ${account.email}, ${account.name}, ${'04' + id.slice(0, 7)},
              '081234567890', ${account.role}, true, ${programId},
              ${account.current_semester}, ${account.is_salut}, ${account.salut_status},
              ${account.salut_approved_at ? account.salut_approved_at.toISOString() : null},
              '台北市', '中正區', '羅斯福路', '1號', '10617', 'Taiwan')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        is_verified = EXCLUDED.is_verified,
        program_id = EXCLUDED.program_id,
        current_semester = EXCLUDED.current_semester,
        is_salut = EXCLUDED.is_salut,
        salut_status = EXCLUDED.salut_status,
        salut_approved_at = EXCLUDED.salut_approved_at`;
  }
  return ids;
}

/** One faculty and programme, so accounts have something to belong to. */
async function seedProgram() {
  const [faculty] = await sql`
    INSERT INTO faculties (code, name, description)
    VALUES ('FST', 'Fakultas Sains dan Teknologi', 'Seed for the acceptance suite')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;

  const [program] = await sql`
    INSERT INTO programs (faculty_id, code, name, level, total_sks)
    VALUES (${faculty.id}, 'S1SI', 'Sistem Informasi', 'S1', 145)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;

  return program.id;
}

/** One module per pricing state the catalogue can be in. */
async function seedModules() {
  const rows = [
    { tbo_code: 'E2E-PRICED', name: 'Modul Berharga', price_student: 50000, is_available: true },
    { tbo_code: 'E2E-NOSTOCK', name: 'Modul Habis', price_student: 65000, is_available: false },
    { tbo_code: 'E2E-UNPRICED', name: 'Modul Belum Berharga', price_student: 0, is_available: true },
    { tbo_code: 'E2E-NULLPRICE', name: 'Modul Tanpa Harga', price_student: null, is_available: true },
  ];
  const ids = {};
  for (const row of rows) {
    const [saved] = await sql`
      INSERT INTO modules (tbo_code, name, price_student, price_general, is_available, weight_grams)
      VALUES (${row.tbo_code}, ${row.name}, ${row.price_student},
              ${row.price_student === null ? null : row.price_student + 10000},
              ${row.is_available}, 500)
      ON CONFLICT (tbo_code) DO UPDATE SET
        name = EXCLUDED.name,
        price_student = EXCLUDED.price_student,
        is_available = EXCLUDED.is_available,
        deleted_at = NULL
      RETURNING id`;
    ids[row.tbo_code] = saved.id;
  }
  return ids;
}

/**
 * The paid almet and the free claim-gated one, each with a size variant, so the
 * variant-selection and claim rules can both be exercised.
 */
async function seedProducts() {
  const ids = {};
  for (const spec of [
    { key: 'paid', tokopedia_id: 'e2e-almet-paid', name: 'Jas Almamater UT', price: 350000, claim_rule: null },
    { key: 'free', tokopedia_id: 'e2e-almet-free', name: 'Jas Almamater UT (Gratis SALUT)', price: 0, claim_rule: 'salut_sem1_once' },
  ]) {
    const [product] = await sql`
      INSERT INTO products (tokopedia_id, category, name, description, base_price, weight_grams, claim_rule)
      VALUES (${spec.tokopedia_id}, 'jas-almamater', ${spec.name},
              'Seed for the acceptance suite', ${spec.price}, 800, ${spec.claim_rule})
      ON CONFLICT (tokopedia_id) DO UPDATE SET
        name = EXCLUDED.name,
        base_price = EXCLUDED.base_price,
        claim_rule = EXCLUDED.claim_rule
      RETURNING id`;

    const [variantType] = await sql`
      INSERT INTO product_variant_types (product_id, name, identifier, sort_order)
      SELECT ${product.id}, 'Ukuran', 'ukuran', 0
       WHERE NOT EXISTS (
         SELECT 1 FROM product_variant_types
          WHERE product_id = ${product.id} AND identifier = 'ukuran')
      RETURNING id`;

    if (variantType) {
      for (const [i, value] of ['M', 'L', 'XL'].entries()) {
        await sql`
          INSERT INTO product_variant_options (variant_type_id, value, sort_order)
          VALUES (${variantType.id}, ${value}, ${i})`;
      }
    }

    for (const size of ['M', 'L', 'XL']) {
      const [existing] = await sql`
        SELECT id FROM product_skus
         WHERE product_id = ${product.id} AND option_names = ${sql.json([size])}`;
      if (existing) {
        await sql`UPDATE product_skus SET price = ${spec.price} WHERE id = ${existing.id}`;
      } else {
        await sql`
          INSERT INTO product_skus (product_id, tokopedia_sku_id, price, option_names)
          VALUES (${product.id}, ${`${spec.tokopedia_id}-${size}`}, ${spec.price}, ${sql.json([size])})`;
      }
    }

    ids[spec.key] = product.id;
  }
  return ids;
}

/** One order per interesting status, so the admin desk has work to look at. */
async function seedOrders(userId, moduleIds) {
  const specs = [
    { number: 'UT-E2E-PENDING', status: 'pending', payment_status: 'pending' },
    { number: 'UT-E2E-AWAITING', status: 'awaiting_payment', payment_status: 'pending' },
    { number: 'UT-E2E-PAID', status: 'paid', payment_status: 'paid' },
    { number: 'UT-E2E-SHIPPED', status: 'shipped', payment_status: 'paid' },
  ];

  for (const spec of specs) {
    const [existing] = await sql`SELECT id FROM orders WHERE order_number = ${spec.number}`;
    if (existing) continue;

    const [order] = await sql`
      INSERT INTO orders (order_number, user_id, status, subtotal, shipping_cost, box_fee,
                          admin_fee, is_salut_order, total_amount, shipping_name,
                          shipping_address, shipping_city, shipping_province,
                          shipping_postal, shipping_country, shipping_phone)
      VALUES (${spec.number}, ${userId}, ${spec.status}, 100000, 300000, 100000, 25000,
              false, 525000, 'Budi Santoso', '羅斯福路 1號', '中正區台北市',
              'Taiwan', '10617', 'Taiwan', '+886912345678')
      RETURNING id`;

    await sql`
      INSERT INTO order_items (order_id, module_id, module_code, module_name, quantity,
                               unit_price, subtotal, is_request, request_status)
      VALUES (${order.id}, ${moduleIds['E2E-PRICED']}, 'E2E-PRICED', 'Modul Berharga',
              2, 50000, 100000, false, NULL)`;

    // A pending order also carries an unpriced request, which is what the admin
    // has to resolve before stock can be confirmed.
    if (spec.status === 'pending') {
      await sql`
        INSERT INTO order_items (order_id, module_id, module_code, module_name, quantity,
                                 unit_price, subtotal, is_request, request_status)
        VALUES (${order.id}, NULL, 'E2E-REQ', 'Modul Permintaan', 1, 0, 0, true, 'pending')`;
    }

    await sql`
      INSERT INTO payments (order_id, gateway, method, bank, amount, unique_code, status, expires_at)
      VALUES (${order.id}, 'manual', 'transfer', 'BCA', 525123, 123, ${spec.payment_status},
              ${new Date(Date.now() + 5 * 86400000).toISOString()})`;
  }
}

/** Applications waiting on an admin, including one to approve in bulk. */
async function seedSalutApplications(programId) {
  for (const [i, email] of ['pending1@e2e.test', 'pending2@e2e.test', 'pending3@e2e.test'].entries()) {
    const id = await ensureAuthUser(email);
    await sql`
      INSERT INTO users (id, email, name, nim, phone, role, is_verified, program_id,
                         current_semester, salut_status, salut_applied_at,
                         salut_payment_proof_url, salut_applied_fee_amount,
                         salut_applied_semester, salut_wa_number)
      VALUES (${id}, ${email}, ${`Pemohon ${i + 1}`}, ${'0490000' + i}, '081200000' || ${i},
              'student', true, ${programId}, 1, 'pending', now(),
              ${`${id}/proof.png`}, 1700, 1, ${'62812000000' + i})
      ON CONFLICT (id) DO UPDATE SET
        salut_status = 'pending',
        salut_applied_at = now(),
        salut_wa_number = EXCLUDED.salut_wa_number`;
  }
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL}`);

  const programId = await seedProgram();
  const userIds = await seedAccounts(programId);
  const moduleIds = await seedModules();
  await seedProducts();
  await seedOrders(userIds['student@e2e.test'], moduleIds);
  await seedSalutApplications(programId);

  console.log('  accounts:  student@e2e.test, member@e2e.test, admin@e2e.test');
  console.log(`  password:  ${PASSWORD}`);
  console.log('  modules:   priced, out-of-stock, zero-priced, unpriced');
  console.log('  products:  paid almet + free claim-gated almet (M/L/XL)');
  console.log('  orders:    pending (with an unpriced request), awaiting_payment, paid, shipped');
  console.log('  salut:     3 applications awaiting an admin');
  console.log('done');
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => sql.end({ timeout: 5 }));
