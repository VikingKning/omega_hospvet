exports.up = function up(knex) {
  return knex.schema
    .createTable('doctores', (table) => {
      table.increments('id').primary();
      table.string('nombre', 100).notNullable();
      table.string('apellidos', 100).notNullable();
      table.boolean('activo').notNullable().defaultTo(true);
      table.integer('creado_por');
      table.timestamp('creado_en', { useTz: true }).notNullable();
      table.integer('actualizado_por');
      table.timestamp('actualizado_en', { useTz: true });
      table.integer('desactivado_por');
      table.timestamp('desactivado_en', { useTz: true });
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "doctores" IS 'Catálogo independiente de usuarios; un doctor puede existir sin cuenta de acceso.'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('doctores');
};
