exports.up = async function up(knex) {
  await knex.raw(
    'ALTER TABLE alertas_atencion_whatsapp DROP CONSTRAINT alertas_atencion_whatsapp_tipo_check',
  );
  await knex.raw(`
    ALTER TABLE alertas_atencion_whatsapp
      ADD CONSTRAINT alertas_atencion_whatsapp_tipo_check
      CHECK (tipo_alerta IN ('emergencia', 'recepcion', 'consentimiento'));
  `);
};

exports.down = async function down(knex) {
  await knex.raw(
    'ALTER TABLE alertas_atencion_whatsapp DROP CONSTRAINT alertas_atencion_whatsapp_tipo_check',
  );
  await knex.raw(`
    ALTER TABLE alertas_atencion_whatsapp
      ADD CONSTRAINT alertas_atencion_whatsapp_tipo_check
      CHECK (tipo_alerta IN ('emergencia', 'recepcion'));
  `);
};
