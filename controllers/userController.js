const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { users, programs } = require('../db/schema');
const { eq, and, ne, or, ilike, inArray, asc, desc, sql } = require('drizzle-orm');
const emailService = require('../services/emailService');
const { nextSalutExpiry } = require('../config/constants');
const { emitUserStatusUpdate } = require('../services/userStatusEventBus');
const { formatDate, formatNTD } = require('../format');

const SORT_MAP = {
  name:             users.name,
  nim:              users.nim,
  email:            users.email,
  created_at:       users.created_at,
  current_semester: users.current_semester,
  salut_status:     users.salut_status,
  program:          programs.name,
};

const ALLOWED_SALUT_STATUSES = new Set(['none', 'pending', 'approved', 'rejected', 'expired']);

const { clampInt, escapeIlike } = require('../utils/pagination');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

async function listUsers(req, res) {
  const {
    search, sort, dir,
    salut,                                    // back-compat: true|false (is_salut)
    salut_status, is_verified, program_id, semester,
    limit: limitRaw, offset: offsetRaw,
  } = req.query;

  const sortCol = SORT_MAP[sort] ? sort : 'created_at';
  const sortDir = dir === 'asc' ? asc : desc;

  const limit = clampInt(limitRaw, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const offset = Math.max(0, clampInt(offsetRaw, 0, Number.MAX_SAFE_INTEGER, 0));

  try {
    const conditions = [eq(users.role, 'student')];

    if (search && search.trim()) {
      const term = `%${escapeIlike(search.trim())}%`;
      conditions.push(or(
        ilike(users.name, term),
        ilike(users.email, term),
        ilike(users.nim, term),
        ilike(users.phone, term),
        ilike(programs.name, term),
        ilike(programs.code, term),
      ));
    }

    if (salut === 'true') conditions.push(eq(users.is_salut, true));
    else if (salut === 'false') conditions.push(eq(users.is_salut, false));

    if (ALLOWED_SALUT_STATUSES.has(salut_status)) {
      conditions.push(eq(users.salut_status, salut_status));
    }

    if (is_verified === 'true') conditions.push(eq(users.is_verified, true));
    else if (is_verified === 'false') conditions.push(eq(users.is_verified, false));

    if (program_id) conditions.push(eq(users.program_id, program_id));

    const semesterNum = Number.parseInt(semester, 10);
    if (Number.isInteger(semesterNum) && semesterNum >= 1 && semesterNum <= 9) {
      conditions.push(eq(users.current_semester, semesterNum));
    }

    const whereClause = and(...conditions);

    const rowsQuery = db
      .select({
        id:               users.id,
        email:            users.email,
        name:             users.name,
        nim:              users.nim,
        phone:            users.phone,
        current_semester: users.current_semester,
        role:             users.role,
        is_verified:      users.is_verified,
        is_salut:         users.is_salut,
        salut_status:     users.salut_status,
        created_at:       users.created_at,
        program_code:     programs.code,
        program_name:     programs.name,
      })
      .from(users)
      .leftJoin(programs, eq(users.program_id, programs.id))
      .where(whereClause)
      .orderBy(sortDir(SORT_MAP[sortCol]))
      .limit(limit)
      .offset(offset);

    const countQuery = db
      .select({ count: sql`count(*)::int` })
      .from(users)
      .leftJoin(programs, eq(users.program_id, programs.id))
      .where(whereClause);

    const [rows, countResult] = await Promise.all([rowsQuery, countQuery]);
    const total = countResult[0]?.count ?? 0;

    res.json({
      rows: rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        nim: u.nim,
        phone: u.phone,
        current_semester: u.current_semester,
        role: u.role,
        is_verified: u.is_verified,
        is_salut: u.is_salut,
        salut_status: u.salut_status,
        created_at: u.created_at,
        programs: u.program_code ? { code: u.program_code, name: u.program_name } : null,
        created_at_display: formatDate(u.created_at),
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateUserSalut(req, res) {
  const { userId } = req.params;
  const { is_salut } = req.body;

  if (typeof is_salut !== 'boolean') {
    return res.status(400).json({ error: 'is_salut must be a boolean' });
  }

  const salutStatusFields = is_salut
    ? { salut_status: 'approved', salut_approved_at: new Date() }
    : { salut_status: 'none', salut_approved_at: null, salut_rejection_reason: null };

  try {
    const [data] = await db.update(users)
      .set({ is_salut, ...salutStatusFields })
      .where(and(eq(users.id, userId), eq(users.role, 'student')))
      .returning({
        id: users.id, email: users.email, name: users.name, nim: users.nim,
        is_salut: users.is_salut, salut_status: users.salut_status,
      });

    if (!data) return res.status(404).json({ error: 'User not found' });
    res.json(data);

    emitUserStatusUpdate(userId, {
      is_salut: !!is_salut,
      is_salut_active: !!is_salut,
      salut_status: is_salut ? 'approved' : 'none',
    });

    if (is_salut) {
      emailService.sendSalutApproved({
        email: data.email,
        name: data.name,
        expiresAt: nextSalutExpiry(new Date()).toISOString(),
      }).catch((err) => console.error('[email] send failed:', err.message));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function bulkUpdateUserSalut(req, res) {
  const { userIds, is_salut } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds must be a non-empty array' });
  }
  if (userIds.length > 200) {
    return res.status(400).json({ error: 'Cannot update more than 200 users at once' });
  }
  if (typeof is_salut !== 'boolean') {
    return res.status(400).json({ error: 'is_salut must be a boolean' });
  }

  const salutStatusFields = is_salut
    ? { salut_status: 'approved', salut_approved_at: new Date() }
    : { salut_status: 'none', salut_approved_at: null, salut_rejection_reason: null };

  try {
    const data = await db.update(users)
      .set({ is_salut, ...salutStatusFields })
      .where(and(inArray(users.id, userIds), eq(users.role, 'student')))
      .returning({ id: users.id });

    const updated = data?.length ?? 0;
    res.json({ updated });

    for (const uid of (data ?? []).map(u => u.id)) {
      emitUserStatusUpdate(uid, {
        is_salut: !!is_salut,
        is_salut_active: !!is_salut,
        salut_status: is_salut ? 'approved' : 'none',
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listSalutApplications(req, res) {
  const { status } = req.query;
  try {
    const conditions = [eq(users.role, 'student')];
    if (status === 'all') conditions.push(ne(users.salut_status, 'none'));
    else conditions.push(eq(users.salut_status, 'pending'));

    const data = await db.query.users.findMany({
      columns: {
        id: true, email: true, name: true, nim: true, current_semester: true,
        salut_applied_at: true, salut_payment_proof_url: true,
        salut_applied_fee_amount: true, salut_applied_semester: true,
      },
      where: and(...conditions),
      orderBy: asc(users.salut_applied_at),
      with: { programs: { columns: { code: true, name: true } } },
    });

    res.json(data.map((u) => ({
      ...u,
      salut_applied_at_display: formatDate(u.salut_applied_at),
      salut_applied_fee_amount_display: u.salut_applied_fee_amount != null
        ? formatNTD(Number(u.salut_applied_fee_amount))
        : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSalutProofUrl(req, res) {
  const { userId } = req.params;

  try {
    const user = await db.query.users.findFirst({
      columns: { salut_payment_proof_url: true, salut_status: true },
      where: and(eq(users.id, userId), eq(users.role, 'student')),
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.salut_payment_proof_url) return res.status(404).json({ error: 'No proof uploaded' });

    const { data, error } = await supabaseAdmin.storage
      .from('salut-proofs')
      .createSignedUrl(user.salut_payment_proof_url, 300); // 5-minute TTL

    if (error) return res.status(500).json({ error: 'Gagal membuat URL' });
    res.json({ signedUrl: data.signedUrl });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat URL' });
  }
}

async function approveSalutApplication(req, res) {
  const { userId } = req.params;
  try {
    const user = await db.query.users.findFirst({
      columns: { salut_status: true },
      where: and(eq(users.id, userId), eq(users.role, 'student')),
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.salut_status !== 'pending') {
      return res.status(400).json({ error: 'Permohonan bukan dalam status pending' });
    }

    const approvedAt = new Date();
    const [data] = await db.update(users)
      .set({ is_salut: true, salut_status: 'approved', salut_approved_at: approvedAt })
      .where(eq(users.id, userId))
      .returning({
        id: users.id, email: users.email, name: users.name, nim: users.nim,
        is_salut: users.is_salut, salut_status: users.salut_status,
      });

    res.json(data);
    emitUserStatusUpdate(userId, { is_salut: true, is_salut_active: true, salut_status: 'approved' });
    emailService.sendSalutApproved({
      email: data.email,
      name: data.name,
      expiresAt: nextSalutExpiry(approvedAt).toISOString(),
    }).catch((err) => console.error('[email] send failed:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function rejectSalutApplication(req, res) {
  const { userId } = req.params;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'Alasan penolakan wajib diisi' });
  }
  if (reason.trim().length > 500) {
    return res.status(400).json({ error: 'Alasan maksimal 500 karakter' });
  }

  try {
    const user = await db.query.users.findFirst({
      columns: { salut_status: true },
      where: and(eq(users.id, userId), eq(users.role, 'student')),
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.salut_status !== 'pending') {
      return res.status(400).json({ error: 'Permohonan bukan dalam status pending' });
    }

    const [data] = await db.update(users)
      .set({ salut_status: 'rejected', salut_rejection_reason: reason.trim() })
      .where(eq(users.id, userId))
      .returning({
        id: users.id, email: users.email, name: users.name, nim: users.nim,
        is_salut: users.is_salut, salut_status: users.salut_status,
      });

    res.json(data);
    emitUserStatusUpdate(userId, { is_salut: false, is_salut_active: false, salut_status: 'rejected' });
    emailService.sendSalutRejected({ email: data.email, name: data.name, reason }).catch((err) => console.error('[email] send failed:', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listUsers,
  updateUserSalut,
  bulkUpdateUserSalut,
  listSalutApplications,
  getSalutProofUrl,
  approveSalutApplication,
  rejectSalutApplication,
};