const { supabaseAdmin } = require('../config/supabase');

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

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ is_salut })
    .eq('id', userId)
    .eq('role', 'student')
    .select('id, email, name, nim, is_salut')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json(data);
}

module.exports = { listUsers, updateUserSalut };
