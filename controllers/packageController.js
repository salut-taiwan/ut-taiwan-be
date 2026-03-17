const { supabaseAdmin } = require('../config/supabase');

async function listPackages(req, res) {
  const { programId, semester } = req.query;

  let query = supabaseAdmin
    .from('packages')
    .select(`
      id, name, description, semester, is_active, program_id,
      programs(id, code, name),
      package_modules(
        sort_order,
        modules(id, tbo_code, name, cover_image_url, price_student, is_available)
      )
    `)
    .eq('is_active', true)
    .order('semester', { ascending: true });

  if (programId) query = query.eq('program_id', programId);
  if (semester) query = query.eq('semester', parseInt(semester));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Compute total price per package
  const result = data.map(pkg => ({
    ...pkg,
    totalPrice: (pkg.package_modules || []).reduce((sum, pm) => sum + (pm.modules?.price_student || 0), 0),
  }));

  res.json(result);
}

async function getPackage(req, res) {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('packages')
    .select(`
      *,
      programs(id, code, name, faculties(code, name)),
      package_modules(
        sort_order,
        modules(*)
      )
    `)
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Paket tidak ditemukan' });

  data.totalPrice = (data.package_modules || []).reduce((sum, pm) => sum + (pm.modules?.price_student || 0), 0);
  res.json(data);
}

module.exports = { listPackages, getPackage };
