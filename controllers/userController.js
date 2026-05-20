const { supabaseAdmin } = require('../config/supabase');
const { db } = require('../db');
const { users } = require('../db/schema');
const { eq, and, ne, or, ilike, inArray, asc, desc } = require('drizzle-orm');
const emailService = require('../services/emailService');
const { nextSalutExpiry } = require('../config/constants');

const ALLOWED_SORT_COLS = new Set(['name', 'nim', 'created_at']);

async function listUsers(req, res) {
  const { search, sort, dir, salut } = req.query;

  const sortCol = ALLOWED_SORT_COLS.has(sort) ? sort : 'created_at';
  const sortDir = dir === 'asc' ? asc : desc;

  try {
    const conditions = [eq(users.role, 'student')];

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(or(
        ilike(users.name, term),
        ilike(users.email, term),
        ilike(users.nim, term),
      ));
    }

    if (salut === 'true') conditions.push(eq(users.is_salut, true));
    else if (salut === 'false') conditions.push(eq(users.is_salut, false));

    const data = await db.query.users.findMany({
      columns: {
        id: true, email: true, name: true, nim: true, phone: true,
        current_semester: true, role: true, is_verified: true, is_salut: true, salut_status: true, created_at: true,
      },
      where: and(...conditions),
      orderBy: sortDir(users[sortCol]),
      with: { programs: { columns: { code: true, name: true } } },
    });

    res.json(data);
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

    if (is_salut) {
      emailService.sendSalutApproved({
        email: data.email,
        name: data.name,
        expiresAt: nextSalutExpiry(new Date()).toISOString(),
      }).catch(() => {});
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

    res.json({ updated: data?.length ?? 0 });
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

    res.json(data);
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
    emailService.sendSalutApproved({
      email: data.email,
      name: data.name,
      expiresAt: nextSalutExpiry(approvedAt).toISOString(),
    }).catch(() => {});
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
    emailService.sendSalutRejected({ email: data.email, name: data.name, reason }).catch(() => {});
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