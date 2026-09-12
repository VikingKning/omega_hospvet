const PLANTILLA_RESULTADOS = 'resultados_laboratorio_listos_v2';

exports.up = async function up(knex) {
  await knex.schema.createTable('envios_whatsapp', (table) => {
    table.increments('id').primary();
    table.string('plantilla', 150).notNullable();
    table.integer('plantilla_id');
    table.string('destinatario_telefono', 20);
    table.boolean('exitoso').notNullable();
    table.string('error_codigo', 50);
    table.text('error_mensaje');
    table.string('origen', 30).notNullable();
    table.integer('referencia_id');
    table.integer('envio_laboratorio_id').unique();
    table.timestamp('enviado_en', { useTz: true }).notNullable();

    table.index('enviado_en');
    table.index(['exitoso', 'enviado_en']);
    table.index(['plantilla', 'enviado_en']);
    table.foreign('plantilla_id').references('id').inTable('plantillas_whatsapp');
    table
      .foreign('envio_laboratorio_id')
      .references('id')
      .inTable('envios_laboratorio')
      .onDelete('CASCADE');
  });

  await knex.raw(`
    COMMENT ON TABLE envios_whatsapp IS 'Bitácora general de cada intento saliente por WhatsApp; fuente de verdad de sus métricas.';
    COMMENT ON COLUMN envios_whatsapp.plantilla IS 'Nombre de la plantilla al momento del intento; se conserva aunque después cambie el catálogo.';
    COMMENT ON COLUMN envios_whatsapp.exitoso IS 'TRUE si Meta aceptó el mensaje; FALSE si el intento terminó en error.';
    COMMENT ON COLUMN envios_whatsapp.origen IS 'laboratorio | respuesta_automatica | agenda | otro';
  `);

  const plantilla = await knex('plantillas_whatsapp')
    .where({ slug: 'resultados-laboratorio-listos-v2' })
    .first('id');
  const historicos = await knex('envios_laboratorio')
    .whereIn('canal_intentado', ['whatsapp', 'ambos'])
    .select(
      'id',
      'registro_laboratorio_id',
      'destinatario_telefono',
      'whatsapp_exitoso',
      'error_whatsapp',
      'enviado_en',
    );

  if (historicos.length) {
    await knex('envios_whatsapp').insert(
      historicos.map((envio) => ({
        plantilla: PLANTILLA_RESULTADOS,
        plantilla_id: plantilla?.id ?? null,
        destinatario_telefono: envio.destinatario_telefono,
        exitoso: Boolean(envio.whatsapp_exitoso),
        error_mensaje: envio.error_whatsapp,
        origen: 'laboratorio',
        referencia_id: envio.registro_laboratorio_id,
        envio_laboratorio_id: envio.id,
        enviado_en: envio.enviado_en,
      })),
    );
  }
};

exports.down = function down(knex) {
  return knex.schema.dropTable('envios_whatsapp');
};
