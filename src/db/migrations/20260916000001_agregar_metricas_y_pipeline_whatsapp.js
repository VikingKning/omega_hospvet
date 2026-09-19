exports.up = async function up(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.string('pipeline_asignado', 30).notNullable().defaultTo('conversacional_nuevo');
    table.string('ruta_enrutamiento', 40);
    table.string('resultado_decision', 50);
    table.timestamp('decision_en', { useTz: true });
    table.integer('reentregas_meta').notNullable().defaultTo(0);
  });

  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.string('pipeline_asignado', 30).notNullable().defaultTo('conversacional_nuevo');
    table.integer('llamadas_claude').notNullable().defaultTo(0);
    table.string('resultado_claude', 30).notNullable().defaultTo('no_usado');
    table.integer('intentos_enrutamiento').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('eventos_metricas_whatsapp', (table) => {
    table.increments('id').primary();
    table.string('clave_evento', 355).notNullable().unique();
    table.string('tipo_evento', 40).notNullable();
    table.string('pipeline_asignado', 30);
    table.integer('mensaje_id').references('id').inTable('mensajes_whatsapp').onDelete('SET NULL');
    table
      .integer('grupo_id')
      .references('group_id')
      .inTable('grupos_whatsapp')
      .onDelete('SET NULL');
    table
      .integer('conversacion_id')
      .references('id')
      .inTable('conversaciones_whatsapp')
      .onDelete('SET NULL');
    table.string('resultado', 40);
    table.timestamp('ocurrido_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE mensajes_whatsapp
      ADD CONSTRAINT mensajes_whatsapp_pipeline_check
      CHECK (pipeline_asignado IN ('conversacional_nuevo', 'flujo_anterior')),
      ADD CONSTRAINT mensajes_whatsapp_reentregas_check
      CHECK (reentregas_meta >= 0);

    ALTER TABLE grupos_whatsapp
      ADD CONSTRAINT grupos_whatsapp_pipeline_check
      CHECK (pipeline_asignado = 'conversacional_nuevo'),
      ADD CONSTRAINT grupos_whatsapp_llamadas_claude_check
      CHECK (llamadas_claude >= 0),
      ADD CONSTRAINT grupos_whatsapp_intentos_enrutamiento_check
      CHECK (intentos_enrutamiento >= 0);

    CREATE INDEX mensajes_whatsapp_pipeline_estado_idx
      ON mensajes_whatsapp (pipeline_asignado, estado_procesamiento, recibido_en);
    CREATE INDEX grupos_whatsapp_decision_idx
      ON grupos_whatsapp (enrutado_en, pipeline_asignado);
    CREATE INDEX eventos_metricas_whatsapp_tipo_fecha_idx
      ON eventos_metricas_whatsapp (tipo_evento, ocurrido_en);

    COMMENT ON COLUMN mensajes_whatsapp.pipeline_asignado IS 'Propietario inmutable elegido al recibir el wamid: conversacional_nuevo | flujo_anterior (US WA 012).';
    COMMENT ON COLUMN mensajes_whatsapp.reentregas_meta IS 'Cantidad de webhooks duplicados recibidos después del primer INSERT del wamid.';
    COMMENT ON COLUMN grupos_whatsapp.llamadas_claude IS 'Número de solicitudes HTTP reales a Claude para este grupo; reintentos de envío no lo modifican.';
    COMMENT ON COLUMN grupos_whatsapp.resultado_claude IS 'no_usado | exito | sin_coincidencia | timeout | no_configurado | etiqueta_invalida | error_api.';
    COMMENT ON COLUMN grupos_whatsapp.intentos_enrutamiento IS 'Cantidad de leases de clasificación adquiridos; permite medir reintentos sin duplicar grupos.';
    COMMENT ON TABLE eventos_metricas_whatsapp IS 'Eventos operativos idempotentes sin contenido clínico ni datos de contacto, usados por US WA 012.';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('eventos_metricas_whatsapp');
  await knex.raw(`
    DROP INDEX IF EXISTS mensajes_whatsapp_pipeline_estado_idx;
    DROP INDEX IF EXISTS grupos_whatsapp_decision_idx;
    ALTER TABLE mensajes_whatsapp
      DROP CONSTRAINT IF EXISTS mensajes_whatsapp_pipeline_check,
      DROP CONSTRAINT IF EXISTS mensajes_whatsapp_reentregas_check;
    ALTER TABLE grupos_whatsapp
      DROP CONSTRAINT IF EXISTS grupos_whatsapp_pipeline_check,
      DROP CONSTRAINT IF EXISTS grupos_whatsapp_llamadas_claude_check,
      DROP CONSTRAINT IF EXISTS grupos_whatsapp_intentos_enrutamiento_check;
  `);
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.dropColumn('pipeline_asignado');
    table.dropColumn('llamadas_claude');
    table.dropColumn('resultado_claude');
    table.dropColumn('intentos_enrutamiento');
  });
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.dropColumn('pipeline_asignado');
    table.dropColumn('ruta_enrutamiento');
    table.dropColumn('resultado_decision');
    table.dropColumn('decision_en');
    table.dropColumn('reentregas_meta');
  });
};
