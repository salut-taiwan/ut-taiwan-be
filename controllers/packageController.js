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

async function syncPackages(req, res) {
  // Rebuild package_modules from live DB: packages → programs → subjects → subject_modules → modules
  const { data: packages, error: pkgErr } = await supabaseAdmin
    .from('packages')
    .select('id, program_id, semester');
  if (pkgErr) return res.status(500).json({ error: pkgErr.message });

  if (!packages || packages.length === 0) {
    return res.json({ linked: 0, packages: 0 });
  }

  // Delete all existing package_modules
  const { error: delErr } = await supabaseAdmin
    .from('package_modules')
    .delete()
    .neq('package_id', '00000000-0000-0000-0000-000000000000'); // delete all rows
  if (delErr) return res.status(500).json({ error: delErr.message });

  let totalLinked = 0;

  for (const pkg of packages) {
    // Get subjects for this program + semester
    const { data: subjects, error: subjErr } = await supabaseAdmin
      .from('subjects')
      .select('id, code')
      .eq('program_id', pkg.program_id)
      .eq('semester_hint', pkg.semester);
    if (subjErr || !subjects || subjects.length === 0) continue;

    const subjectIds = subjects.map(s => s.id);

    // Get subject_modules for these subjects
    const { data: smLinks, error: smErr } = await supabaseAdmin
      .from('subject_modules')
      .select('module_id, subject_id')
      .in('subject_id', subjectIds);
    if (smErr || !smLinks || smLinks.length === 0) continue;

    // Deduplicate module_ids
    const uniqueModuleIds = [...new Set(smLinks.map(sm => sm.module_id))];

    const rows = uniqueModuleIds.map((moduleId, idx) => ({
      package_id: pkg.id,
      module_id: moduleId,
      sort_order: idx + 1,
    }));

    const { error: insErr } = await supabaseAdmin
      .from('package_modules')
      .insert(rows);

    if (!insErr) totalLinked += rows.length;
  }

  res.json({ linked: totalLinked, packages: packages.length });
}

module.exports = { listPackages, getPackage, syncPackages };
