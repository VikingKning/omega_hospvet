exports.up = function up(knex) {
  return knex.schema.createTable('catalogo_estudios', (table) => {
    table.increments('id').primary();
    table.integer('categoria_id').notNullable();
    table.string('codigo', 50).notNullable().unique();
    table.string('nombre', 200).notNullable();
    table.boolean('requiere_zona').notNullable().defaultTo(false);
    table.boolean('activo').notNullable().defaultTo(true);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTable('catalogo_estudios');
};
