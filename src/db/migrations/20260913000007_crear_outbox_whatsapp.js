exports.up = async function up(knex) {
  await knex.schema.createTable('outbox_whatsapp', (table) => {
    table.increments('intent_id').primary();
    table.string('clave_idempotencia', 255).notNullable().unique();
    table.string('tipo_envio', 30).notNullable();
    table.string('origen_funcional', 30).notNullable();
    table.integer('conversacion_id').references('id').inTable('conversaciones_whatsapp');
    table.string('destinatario_telefono', 20).notNullable();
    table.json('payload_funcional').notNullable();
    table.boolean('usa_plantilla').notNullable().defaultTo(false);
    table.string('categoria_facturacion_meta', 20);
    table.string('estado', 30).notNullable().defaultTo('pendiente');
    table.string('estado_meta', 20);
    table.string('wamid', 100);
    table.integer('intentos').notNullable().defaultTo(0);
    table.text('ultimo_error');
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE UNIQUE INDEX outbox_whatsapp_wamid_unique ON outbox_whatsapp (wamid) WHERE wamid IS NOT NULL;

    COMMENT ON TABLE "outbox_whatsapp" IS 'Intenciones de envío saliente registradas ANTES de llamar a Meta (US WA 015) — idempotencia por clave_idempotencia y guarda de reintento; envios_whatsapp sigue siendo la bitácora histórica por intento, sin relación con esta tabla.';
    COMMENT ON COLUMN "outbox_whatsapp"."tipo_envio" IS 'conversacional (respuesta a tutor, sujeta a ventana de 24h) | laboratorio (plantilla aprobada, sin ventana) | alerta_interna (staff, sin ventana; sin lógica de envío propia en esta historia)';
    COMMENT ON COLUMN "outbox_whatsapp"."origen_funcional" IS 'Mismo vocabulario de negocio que envios_whatsapp.origen (laboratorio | respuesta_automatica | alerta_interna | otro).';
    COMMENT ON COLUMN "outbox_whatsapp"."estado" IS 'pendiente | enviado | fallido | ventana_servicio_expirada — ciclo de vida LOCAL del intento (no confundir con conversaciones_whatsapp.estado ni con estado_meta).';
    COMMENT ON COLUMN "outbox_whatsapp"."estado_meta" IS 'sent | delivered | read | failed — último estado de entrega reportado por el webhook de Meta (AC3); independiente de "estado".';
    COMMENT ON COLUMN "outbox_whatsapp"."payload_funcional" IS 'Body ya decidido y listo para Meta ({tipo:"text", texto} o {tipo:"template", plantilla:{name,language,components}}) — un reintento lo reutiliza tal cual, nunca lo reconstruye.';
  `);
};

exports.down = function down(knex) {
  return knex.schema.dropTable('outbox_whatsapp');
};
