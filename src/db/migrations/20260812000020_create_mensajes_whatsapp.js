exports.up = function up(knex) {
  return knex.schema
    .createTable('mensajes_whatsapp', (table) => {
      table.increments('id').primary();
      table.string('telefono_origen', 20).notNullable();
      table.text('mensaje_recibido').notNullable();
      table.string('categoria_clasificacion', 30).notNullable();
      table.integer('plantilla_id');
      table.integer('tokens_entrada').notNullable();
      table.integer('tokens_salida').notNullable();
      table.integer('cita_generada_id');
      table.integer('registro_laboratorio_id');
      table.timestamp('recibido_en', { useTz: true }).notNullable();
      table.timestamp('procesado_en', { useTz: true });
    })
    .then(() =>
      knex.raw(`
    COMMENT ON TABLE "mensajes_whatsapp" IS 'Fuente de las métricas del bloque WhatsApp (2.5.1). telefono_origen puede correlacionar con propietarios.telefono si hay coincidencia.';
    COMMENT ON COLUMN "mensajes_whatsapp"."categoria_clasificacion" IS 'emergencia | duda_medica | agendar_cita | resultados_laboratorio';
  `),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('mensajes_whatsapp');
};
