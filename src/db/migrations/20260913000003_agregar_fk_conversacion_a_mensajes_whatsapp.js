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
