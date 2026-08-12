exports.up = function up(knex) {
  return knex.schema
    .createTable('permissions', (table) => {
      table.increments('id').primary();
      table.string('modulo', 50).notNullable();
      table.string('accion', 30).notNullable();
      table.string('codigo', 100).notNullable().unique();
      table.text('descripcion');
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "permissions" IS 'Catálogo fijo de permisos posibles, consumido por requirePermission().'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('permissions');
};
