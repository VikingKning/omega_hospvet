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
