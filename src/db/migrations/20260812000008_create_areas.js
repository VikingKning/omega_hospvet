exports.up = function up(knex) {
  return knex.schema
    .createTable('areas', (table) => {
      table.increments('id').primary();
      table.string('nombre', 100).notNullable().unique();
      table.string('slug', 100).notNullable().unique();
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
        `COMMENT ON TABLE "areas" IS 'Cada área activa genera automáticamente su propia vista de agenda (2.3).'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('areas');
};
