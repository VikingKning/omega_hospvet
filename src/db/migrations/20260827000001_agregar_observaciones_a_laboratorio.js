exports.up = function up(knex) {
  return Promise.all([
    knex.schema.alterTable('registros_laboratorio', (table) => {
      table.text('observaciones');
    }),
    knex.schema.alterTable('estudios_solicitados', (table) => {
      table.text('observaciones');
    }),
  ]);
};

exports.down = function down(knex) {
  return Promise.all([
    knex.schema.alterTable('registros_laboratorio', (table) => {
      table.dropColumn('observaciones');
    }),
    knex.schema.alterTable('estudios_solicitados', (table) => {
      table.dropColumn('observaciones');
    }),
  ]);
};
