// US WA 013: 3 marcas para el seguimiento/expiración de flujos automáticos,
// persistidas (no en memoria) para recuperar el control tras un reinicio de
// PM2 (consideración técnica) — mismo idioma que
// conversaciones_whatsapp.procesamiento_iniciado_en de US WA 003.
exports.up = async function up(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.timestamp('recordatorio_programado_en', { useTz: true });
    table.timestamp('recordatorio_enviado_en', { useTz: true });
    table.timestamp('flujo_expira_en', { useTz: true });
  });
  await knex.raw(`
    COMMENT ON COLUMN "conversaciones_whatsapp"."recordatorio_programado_en" IS 'Cuándo debe enviarse la pregunta de seguimiento (Continuar/Volver al menú) si no hay interacción del tutor antes — solo una interacción real del tutor la recalcula (US WA 013, AC1).';
    COMMENT ON COLUMN "conversaciones_whatsapp"."recordatorio_enviado_en" IS 'Cuándo se envió realmente la pregunta de seguimiento — NULL mientras no se ha enviado; también sirve de guardia de idempotencia para que 2 workers no la envíen 2 veces (US WA 013, AC1/consideración técnica).';
    COMMENT ON COLUMN "conversaciones_whatsapp"."flujo_expira_en" IS 'Cuándo se cierra la conversación por inactividad si no hay una nueva interacción tras el seguimiento — se calcula al enviar el seguimiento (US WA 013, AC6).';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.dropColumn('recordatorio_programado_en');
    table.dropColumn('recordatorio_enviado_en');
    table.dropColumn('flujo_expira_en');
  });
};
