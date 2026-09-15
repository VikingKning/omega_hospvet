// US WA 017: 2 columnas nuevas en conversaciones_whatsapp —
// atencion_humana_desde/atencion_humana_hasta YA existían desde
// 20260913000002 (US WA 002, sin uso real hasta ahora).
//
// motivo_cierre: por qué se cerró una conversación (AC12/AC15/AC16) —
// distinto y más específico que el mero cerrado_en que ya existía (US WA
// 003/013 lo dejaban sin motivo explícito, esta historia sí lo necesita
// para distinguir solicitud_tutor de vencimiento_atencion_humana). Se deja
// NULLABLE y no se backfillea ningún cierre histórico — no se puede saber
// su motivo real retroactivamente.
//
// origen_atencion_humana: cómo entró la conversación a atencion_humana —
// 'solicitud_transferencia' (vía solicitudes_atencion_humana, AC1-AC24) o
// 'iniciada_por_omega' (vía smb_message_echoes, AC26) — necesario porque
// AC29 exige NO mandar el aviso genérico cuando ya fue iniciada
// manualmente desde Omega.
exports.up = async function up(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.string('motivo_cierre', 30);
    table.string('origen_atencion_humana', 30);
  });
  await knex.raw(`
    COMMENT ON COLUMN "conversaciones_whatsapp"."motivo_cierre" IS 'Por qué se cerró esta conversación cuando aplica: solicitud_tutor | vencimiento_atencion_humana (US WA 017) — NULL para cierres de historias previas (WA003/WA013) que no lo registraban.';
    COMMENT ON COLUMN "conversaciones_whatsapp"."origen_atencion_humana" IS 'Cómo entró a atencion_humana: solicitud_transferencia (US WA 017 AC1-24, vía solicitudes_atencion_humana) | iniciada_por_omega (AC25-31, vía smb_message_echoes) — NULL si nunca estuvo en atencion_humana.';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.dropColumn('motivo_cierre');
    table.dropColumn('origen_atencion_humana');
  });
};
