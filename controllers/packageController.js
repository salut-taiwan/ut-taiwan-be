const { db } = require('../db');
const { packages, package_modules, subjects, subject_modules } = require('../db/schema');
const { eq, and, asc, inArray } = require('drizzle-orm');
const { presentPackage } = require('../presenters/packagePresenter');

async function listPackages(req, res) {
  const { programId, semester } = req.query;
  try {
    const conditions = [eq(packages.is_active, true)];
    if (programId) conditions.push(eq(packages.program_id, programId));
    if (semester) conditions.push(eq(packages.semester, parseInt(semester)));

    const data = await db.query.packages.findMany({
      columns: { id: true, name: true, description: true, semester: true, is_active: true, program_id: true },
      where: and(...conditions),
      orderBy: asc(packages.semester),
      with: {
        programs: { columns: { id: true, code: true, name: true } },
        package_modules: {
          columns: { sort_order: true },
          with: {
            modules: {
              columns: { id: true, tbo_code: true, name: true, cover_image_url: true, price_student: true, is_available: true },
            },
          },
        },
      },
    });

    const result = data.map(pkg => presentPackage({
      ...pkg,
      totalPrice: (pkg.package_modules || []).reduce((sum, pm) => sum + Number(pm.modules?.price_student || 0), 0),
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPackage(req, res) {
  const { id } = req.params;
  try {
    const data = await db.query.packages.findFirst({
      where: eq(packages.id, id),
      with: {
        programs: {
          columns: { id: true, code: true, name: true },
          with: { faculties: { columns: { code: true, name: true } } },
        },
        package_modules: {
          columns: { sort_order: true },
          with: { modules: true },
        },
      },
    });

    if (!data) return res.status(404).json({ error: 'Paket tidak ditemukan' });

    data.totalPrice = (data.package_modules || []).reduce(
      (sum, pm) => sum + Number(pm.modules?.price_student || 0), 0,
    );
    res.json(presentPackage(data));
  } catch (err) {
    res.status(404).json({ error: 'Paket tidak ditemukan' });
  }
}

async function syncPackages(req, res) {
  try {
    const allPackages = await db
      .select({ id: packages.id, program_id: packages.program_id, semester: packages.semester })
      .from(packages);

    if (allPackages.length === 0) {
      return res.json({ linked: 0, packages: 0 });
    }

    // Delete all existing package_modules
    await db.delete(package_modules);

    let totalLinked = 0;

    for (const pkg of allPackages) {
      if (!pkg.program_id || pkg.semester == null) continue;

      // Get subjects for this program + semester
      const pkgSubjects = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.program_id, pkg.program_id), eq(subjects.semester_hint, pkg.semester)));

      if (pkgSubjects.length === 0) continue;

      const subjectIds = pkgSubjects.map(s => s.id);

      const smLinks = await db
        .select({ module_id: subject_modules.module_id })
        .from(subject_modules)
        .where(inArray(subject_modules.subject_id, subjectIds));

      if (smLinks.length === 0) continue;

      const uniqueModuleIds = [...new Set(smLinks.map(sm => sm.module_id))];

      const rows = uniqueModuleIds.map((moduleId, idx) => ({
        package_id: pkg.id,
        module_id: moduleId,
        sort_order: idx + 1,
      }));

      try {
        await db.insert(package_modules).values(rows);
        totalLinked += rows.length;
      } catch (err) {
        // skip on error, continue with next package
      }
    }

    res.json({ linked: totalLinked, packages: allPackages.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listPackages, getPackage, syncPackages };