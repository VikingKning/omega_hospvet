exports.up = function up(knex) {
  return knex.schema.alterTable('mascotas', (table) => {
    table.string('sexo', 10);
    table.integer('anio_nacimiento');
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('mascotas', (table) => {
    table.dropColumn('sexo');
    table.dropColumn('anio_nacimiento');
  });
};
