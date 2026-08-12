exports.up = function up(knex) {
  return knex.schema
    .createTable('usuario_permisos', (table) => {
      table.increments('id').primary();
      table.integer('usuario_id').notNullable();
      table.integer('permission_id').notNullable();
      table.integer('otorgado_por');
      table.timestamp('otorgado_en', { useTz: true }).notNullable();
      table.unique(['usuario_id', 'permission_id']);
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "usuario_permisos" IS 'Matriz de permisos por usuario, sin rol intermedio (2.6.2). Se cachea en sesión al hacer login.'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('usuario_permisos');
};
