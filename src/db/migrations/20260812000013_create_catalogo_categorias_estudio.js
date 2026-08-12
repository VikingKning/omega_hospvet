exports.up = function up(knex) {
  return knex.schema.createTable('catalogo_categorias_estudio', (table) => {
    table.increments('id').primary();
    table.string('nombre', 100).notNullable().unique();
    table.boolean('activo').notNullable().defaultTo(true);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTable('catalogo_categorias_estudio');
};
