const { supabaseAdmin } = require('../config/supabase');

async function listModules(req, res) {
  const { page = 1, limit = 20, available } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabaseAdmin
    .from('modules')
    .select('id, tbo_code, name, edition, cover_image_url, price_student, price_general, is_available, has_multimedia', { count: 'exact' })
    .is('deleted_at', null)
    .order('tbo_code')
    .range(offset, offset + parseInt(limit) - 1);

  if (available === 'true') query = query.eq('is_available', true);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ data, total: count, page: parseInt(page), limit: parseInt(limit) });
}

async function searchModules(req, res) {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Query minimal 2 karakter' });
  }

  const { data, error } = await supabaseAdmin
    .from('modules')
    .select('id, tbo_code, name, edition, cover_image_url, price_student, is_available')
    .is('deleted_at', null)
    .or(`tbo_code.ilike.%${q}%,name.ilike.%${q}%`)
    .order('tbo_code')
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function getModule(req, res) {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('modules')
    .select(`
      *,
      subject_modules(
        subjects(id, code, name, programs(id, code, name))
      )
    `)
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Modul tidak ditemukan' });
  res.json(data);
}

module.exports = { listModules, searchModules, getModule };
