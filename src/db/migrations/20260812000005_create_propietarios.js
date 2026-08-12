exports.up = function up(knex) {
  return knex.schema
    .createTable('propietarios', (table) => {
      table.increments('id').primary();
      table.string('nombre', 150).notNullable();
      table.string('telefono', 20).notNullable().unique();
      table.string('correo', 150);
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
        `COMMENT ON TABLE "propietarios" IS 'UI: "Tutor". El teléfono es el identificador de búsqueda al dar de alta cita/laboratorio y el canal de WhatsApp.'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('propietarios');
};
