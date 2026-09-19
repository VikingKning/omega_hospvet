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
