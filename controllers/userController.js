const { supabaseAdmin } = require('../config/supabase');
const emailService = require('../services/emailService');

const ALLOWED_SORT_COLS = new Set(['name', 'nim', 'created_at']);

async function listUsers(req, res) {
  const { search, sort, dir, salut } = req.query;

  const sortCol = ALLOWED_SORT_COLS.has(sort) ? sort : 'created_at';
  const sortDir = dir === 'asc' ? true : false; // ascending = true

  let query = supabaseAdmin
    .from('users')
    .select('id, email, name, nim, phone, current_semester, role, is_verified, is_salut, created_at, programs(code, name)')
    .eq('role', 'student')
    .order(sortCol, { ascending: sortDir });

  if (search && search.trim()) {
    const term = search.trim();
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,nim.ilike.%${term}%`);
  }

  if (salut === 'true') {
    query = query.eq('is_salut', true);
  } else if (salut === 'false') {
    query = query.eq('is_salut', false);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function updateUserSalut(req, res) {
  const { userId } = req.params;
  const { is_salut } = req.body;

  if (typeof is_salut !== 'boolean') {
    return res.status(400).json({ error: 'is_salut must be a boolean' });
  }

  const salutStatusFields = is_salut
    ? { salut_status: 'approved', salut_approved_at: new Date().toISOString() }
    : { salut_status: 'none', salut_approved_at: null, salut_rejection_reason: null };

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ is_salut, ...salutStatusFields })
    .eq('id', userId)
    .eq('role', 'student')
    .select('id, email, name, nim, is_salut, salut_status')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json(data);
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
    ? { salut_status: 'approved', salut_approved_at: new Date().toISOString() }
    : { salut_status: 'none', salut_approved_at: null, salut_rejection_reason: null };

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ is_salut, ...salutStatusFields })
    .in('id', userIds)
    .eq('role', 'student')
    .select('id');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ updated: data?.length ?? 0 });
}

async function listSalutApplications(req, res) {
  const { status } = req.query;

  let query = supabaseAdmin
    .from('users')
    .select('id, email, name, nim, current_semester, salut_applied_at, salut_payment_proof_url, programs(code, name)')
    .eq('role', 'student')
    .order('salut_applied_at', { ascending: true });

  if (status === 'all') {
    query = query.neq('salut_status', 'none');
  } else {
    query = query.eq('salut_status', 'pending');
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function getSalutProofUrl(req, res) {
  const { userId } = req.params;

  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('salut_payment_proof_url, salut_status')
    .eq('id', userId)
    .eq('role', 'student')
    .single();

  if (fetchError || !user) return res.status(404).json({ error: 'User not found' });
  if (!user.salut_payment_proof_url) return res.status(404).json({ error: 'No proof uploaded' });

  const { data, error } = await supabaseAdmin.storage
    .from('salut-proofs')
    .createSignedUrl(user.salut_payment_proof_url, 300); // 5-minute TTL

  if (error) return res.status(500).json({ error: 'Gagal membuat URL' });
  res.json({ signedUrl: data.signedUrl });
}

async function approveSalutApplication(req, res) {
  const { userId } = req.params;

  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('salut_status')
    .eq('id', userId)
    .eq('role', 'student')
    .single();

  if (fetchError || !user) return res.status(404).json({ error: 'User not found' });
  if (user.salut_status !== 'pending') {
    return res.status(400).json({ error: 'Permohonan bukan dalam status pending' });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ is_salut: true, salut_status: 'approved', salut_approved_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, email, name, nim, is_salut, salut_status')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);

  emailService.sendSalutApproved({ email: data.email, name: data.name }).catch(() => {});
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

  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('salut_status')
    .eq('id', userId)
    .eq('role', 'student')
    .single();

  if (fetchError || !user) return res.status(404).json({ error: 'User not found' });
  if (user.salut_status !== 'pending') {
    return res.status(400).json({ error: 'Permohonan bukan dalam status pending' });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ salut_status: 'rejected', salut_rejection_reason: reason.trim() })
    .eq('id', userId)
    .select('id, email, name, nim, is_salut, salut_status')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);

  emailService.sendSalutRejected({ email: data.email, name: data.name, reason }).catch(() => {});
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
