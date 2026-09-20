// Hasta ahora nada impedía borrar a mano una fila de aviso_privacidad_versiones
// aunque ya existiera un consentimiento_lfpdppp.version_aviso apuntando a ella
// — rompiendo la evidencia que esa tabla existe para conservar (ver
// migración 20260919000005). ON DELETE RESTRICT hace que la base de datos
// rechace ese borrado en vez de depender de que nadie lo haga por error.
exports.up = async function up(knex) {
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.unique('version');
  });

  await knex.schema.alterTable('consentimiento_lfpdppp', (table) => {
    table
      .foreign('version_aviso')
      .references('version')
      .inTable('aviso_privacidad_versiones')
      .onDelete('RESTRICT');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('consentimiento_lfpdppp', (table) => {
    table.dropForeign('version_aviso');
  });
  await knex.schema.alterTable('aviso_privacidad_versiones', (table) => {
    table.dropUnique('version');
  });
};
