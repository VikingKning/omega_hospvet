exports.up = function up(knex) {
  return knex.schema
    .createTable('registros_laboratorio', (table) => {
      table.increments('id').primary();
      table.integer('mascota_id').notNullable();
      table.integer('doctor_id');
      table.date('fecha_solicitud').notNullable();
      table.string('estado', 20).notNullable();
      table.timestamp('pendiente_desde', { useTz: true }).notNullable();
      table.timestamp('cargado_en', { useTz: true });
      table.timestamp('enviado_en', { useTz: true });
      table.boolean('eliminado').notNullable().defaultTo(false);
      table.integer('eliminado_por');
      table.timestamp('eliminado_en', { useTz: true });
      table.integer('creado_por').notNullable();
      table.timestamp('creado_en', { useTz: true }).notNullable();
      table.integer('actualizado_por');
      table.timestamp('actualizado_en', { useTz: true });
    })
    .then(() =>
      knex.raw(`
    COMMENT ON TABLE "registros_laboratorio" IS 'Registro único de laboratorio (sin QVET). El tutor se obtiene vía mascotas.propietario_id.';
    COMMENT ON COLUMN "registros_laboratorio"."estado" IS 'pendiente | cargado | enviado';
  `),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('registros_laboratorio');
};
