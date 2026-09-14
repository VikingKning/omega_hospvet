// US WA 002: agrega la FK que la migración de US WA 001
// (20260913000001) dejó pendiente a propósito — la columna
// mensajes_whatsapp.conversacion_id ya existe (nullable), solo faltaba
// conversaciones_whatsapp para poder apuntarle. Mismo idioma que
// 20260812000021_add_foreign_keys.js.
exports.up = async function up(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table
      .foreign('conversacion_id')
      .references('id')
      .inTable('conversaciones_whatsapp')
      .deferrable('immediate');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.dropForeign('conversacion_id');
  });
};
