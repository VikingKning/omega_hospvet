// US WA 017: entidad central que unifica la transferencia temporal de una
// conversación hacia el personal de Omega — un único mecanismo para
// Emergencia/Recepción/futuros orígenes (AC23), en vez de duplicar
// estados/mensajes/vencimientos/reglas de reactivación por origen.
//
// `envio_previo_id`/`outbox_id` referencian outbox_whatsapp.intent_id (US
// WA 015), NO otra solicitud: "envio_previo" es un mensaje que debe salir
// ANTES del aviso genérico de transferencia (AC5, ej. una alerta propia de
// Emergencia armada por esa historia — WA017 no construye ese contenido,
// solo respeta el orden si existe); "outbox_id" es el intent del propio
// aviso genérico de transferencia que ESTA historia sí registra (AC3).
//
// Sin CHECK constraints — mismo criterio ya establecido en todo el módulo
// de WhatsApp (documentar valores válidos vía COMMENT ON COLUMN).
exports.up = async function up(knex) {
  await knex.schema.createTable('solicitudes_atencion_humana', (table) => {
    table.increments('id').primary();
    table
      .integer('conversacion_id')
      .notNullable()
      .references('id')
      .inTable('conversaciones_whatsapp');
    table.string('origen', 30).notNullable();
    table.string('prioridad', 20);
    table.string('clave_idempotencia', 255).notNullable().unique();
    table.string('estado', 30).notNullable().defaultTo('pendiente');
    table.integer('envio_previo_id').references('intent_id').inTable('outbox_whatsapp');
    table.integer('outbox_id').references('intent_id').inTable('outbox_whatsapp');
    // AC24: referencias funcionales del origen (ej. el id de la alerta de
    // Emergencia que disparó esto) para auditoría — JSON libre a propósito,
    // cada origen trae su propia forma; NUNCA se mezcla con el contenido
    // visible del mensaje genérico (ese vive fijo en whatsapp.menu.js, sin
    // interpolar nada de aquí).
    table.json('referencias_funcionales');
    table.timestamp('solicitado_en', { useTz: true }).notNullable();
    table.timestamp('enviado_en', { useTz: true });
    table.timestamp('finalizado_en', { useTz: true });
    table.string('motivo_cierre', 30);
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    COMMENT ON TABLE "solicitudes_atencion_humana" IS 'US WA 017: mecanismo único de transferencia temporal de una conversación al personal de Omega — un registro por transferencia, deduplicado por clave_idempotencia.';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."origen" IS 'Origen controlado que disparó la solicitud: emergencia | recepcion (AC23/consideración técnica: sin texto libre).';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."prioridad" IS 'Prioridad funcional que trae el origen (ej. alta/normal) — solo auditoría, nunca decide el ciclo de atención humana en sí (AC23).';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."clave_idempotencia" IS 'Construida por el origen a partir de una referencia estable (origen+conversación+evento, AC2/consideración técnica) — un reintento con la misma clave reutiliza esta fila.';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."estado" IS 'pendiente | enviando | enviada | fallida_reintentable | fallida_terminal | finalizada — ciclo de vida LOCAL de la solicitud (no confundir con outbox_whatsapp.estado del intent de envío).';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."envio_previo_id" IS 'outbox_whatsapp.intent_id de un mensaje que debe confirmarse enviado ANTES del aviso genérico de transferencia (AC5) — NULL si no aplica.';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."outbox_id" IS 'outbox_whatsapp.intent_id del aviso genérico de transferencia que esta misma solicitud registra (AC3).';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."motivo_cierre" IS 'Motivo por el que la solicitud dejó de estar activa cuando aplica (ej. fallida_terminal) — independiente de conversaciones_whatsapp.motivo_cierre.';
  `);
};

exports.down = function down(knex) {
  return knex.schema.dropTable('solicitudes_atencion_humana');
};
