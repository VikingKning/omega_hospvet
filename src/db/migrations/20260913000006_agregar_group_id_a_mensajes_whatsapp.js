// US WA 003 (AC7/AC10): relaciona cada mensaje con el grupo al que fue
// consolidado. grupos_whatsapp ya existe desde la migración anterior de
// esta misma US, así que columna y FK van juntas en una sola migración —
// a diferencia de mensajes_whatsapp.conversacion_id en WA 002, que
// necesitó 2 migraciones porque conversaciones_whatsapp no existía
// todavía cuando se agregó esa columna.
exports.up = async function up(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table
      .integer('group_id')
      .references('group_id')
      .inTable('grupos_whatsapp')
      .deferrable('immediate');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.dropColumn('group_id');
  });
};
