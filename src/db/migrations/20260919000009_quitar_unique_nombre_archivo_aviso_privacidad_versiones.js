// Ahora que la detección de duplicados es por nombre+hash (ver migración
// 20260919000008), dos filas de versión pueden apuntar al MISMO archivo
// físico a propósito (p.ej. "v1.0" y "v3.0" del mismo PDF) — la UNIQUE
// original ya no aplica.
exports.up = async function up(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.dropUnique('nombre_archivo');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.unique('nombre_archivo');
  });
};
