exports.up = async function up(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.string('estado_procesamiento', 30).notNullable().defaultTo('pendiente').alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.string('estado_procesamiento', 20).notNullable().defaultTo('pendiente').alter();
  });
};
