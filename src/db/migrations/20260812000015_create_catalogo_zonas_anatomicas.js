exports.up = function up(knex) {
  return knex.schema.createTable('catalogo_zonas_anatomicas', (table) => {
    table.increments('id').primary();
    table.string('codigo', 50).notNullable().unique();
    table.string('nombre', 100).notNullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTable('catalogo_zonas_anatomicas');
};
