// `slug` es la clave estable que un LLM usará para elegir una plantilla
// (ver discusión con el usuario): a diferencia de `intencion` (texto libre,
// editable, es solo la etiqueta que ve el personal), `slug` se fija UNA
// SOLA VEZ al crear la plantilla y nunca vuelve a cambiar — ni siquiera si
// se edita la intención más adelante (de hecho, tras esta migración
// `intencion` deja de ser editable, ver plantillas_whatsapp.service.js).
// Esto preserva la identidad de la plantilla para el histórico de
// mensajes_whatsapp.plantilla_id: si el slug pudiera cambiar de
// significado, un mensaje viejo ligado a esa plantilla quedaría
// re-interpretado en silencio.
//
// Mismo `slugify` que areas.service.js, copiado a propósito (no importado
// desde otro módulo — cada migración congela su propia lógica en el tiempo,
// y los módulos de dominio son deliberadamente independientes entre sí, ver
// el comentario de areas.repository.js#asegurarPermisosAgenda). Las filas
// que ya existan (si el catálogo ya tiene plantillas reales) se backfillean
// aquí mismo antes de aplicar NOT NULL + UNIQUE, para que la migración
// nunca truene contra datos reales.
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

  // Statements explícitos por Postgres en vez de un segundo
  // `table.string(...).alter()` encadenado con notNullable()+unique() — más
  // predecible que depender de cómo Knex combine ambas cosas en un solo
  // ALTER COLUMN.
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
