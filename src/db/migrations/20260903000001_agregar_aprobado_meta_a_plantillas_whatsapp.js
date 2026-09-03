exports.up = function up(knex) {
  return knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.boolean('aprobado_meta').notNullable().defaultTo(false);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.dropColumn('aprobado_meta');
  });
};
