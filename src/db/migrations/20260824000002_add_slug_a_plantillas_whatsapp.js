const DIACRITIC_MARKS = /[̀-ͯ]/g;

function slugify(intencion) {
  return intencion
    .normalize('NFD')
    .replace(DIACRITIC_MARKS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.string('slug', 100);
  });

  const filas = await knex('plantillas_whatsapp').select('id', 'intencion').orderBy('id');
  const slugsUsados = new Set();
  for (const fila of filas) {
    const base = slugify(fila.intencion);
    let slug = base;
    let suffix = 2;
    while (slugsUsados.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    slugsUsados.add(slug);
    await knex('plantillas_whatsapp').where({ id: fila.id }).update({ slug });
  }

  await knex.raw('ALTER TABLE plantillas_whatsapp ALTER COLUMN slug SET NOT NULL');
  await knex.raw(
    'ALTER TABLE plantillas_whatsapp ADD CONSTRAINT plantillas_whatsapp_slug_unique UNIQUE (slug)',
  );
};

exports.down = function down(knex) {
  return knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.dropColumn('slug');
  });
};
