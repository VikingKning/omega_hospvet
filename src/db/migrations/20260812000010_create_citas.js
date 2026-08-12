exports.up = function up(knex) {
  return knex.schema
    .createTable('citas', (table) => {
      table.increments('id').primary();
      table.integer('area_id').notNullable();
      table.integer('doctor_id').notNullable();
      table.integer('mascota_id').notNullable();
      table.timestamp('fecha_hora_inicio', { useTz: true }).notNullable();
      table.integer('duracion_minutos').notNullable();
      table.text('motivo');
      table.string('estado', 20).notNullable();
      table.string('origen', 20).notNullable();
      table.string('google_event_id', 255);
      table.timestamp('google_sincronizado_en', { useTz: true });
      table.timestamp('mensaje_confirmacion_enviado_en', { useTz: true });
      table.integer('creado_por');
      table.timestamp('creado_en', { useTz: true }).notNullable();
      table.integer('confirmada_por');
      table.timestamp('confirmada_en', { useTz: true });
      table.integer('cancelado_por');
      table.timestamp('cancelado_en', { useTz: true });
      table.integer('actualizado_por');
      table.timestamp('actualizado_en', { useTz: true });
    })
    .then(() =>
      knex.raw(`
    COMMENT ON TABLE "citas" IS 'Fuente de verdad de la agenda; Google Calendar es solo espejo (Decisión 7). El tutor se obtiene vía mascotas.propietario_id.';
    COMMENT ON COLUMN "citas"."estado" IS 'registrada | confirmada | cancelada';
    COMMENT ON COLUMN "citas"."origen" IS 'portal | whatsapp';
  `),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('citas');
};
