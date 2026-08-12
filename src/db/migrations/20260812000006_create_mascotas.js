exports.up = function up(knex) {
  return knex.schema
    .createTable('mascotas', (table) => {
      table.increments('id').primary();
      table.integer('propietario_id').notNullable();
      table.string('nombre', 100).notNullable();
      table.string('tipo', 20);
      table.string('raza', 100);
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
        `COMMENT ON TABLE "mascotas" IS 'UI: "Paciente". Un propietario puede tener una o más mascotas (1 a muchos).'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('mascotas');
};
