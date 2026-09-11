exports.up = function up(knex) {
  return knex.raw(`
    COMMENT ON COLUMN "envios_laboratorio"."destinatario_correo" IS 'Correo exacto al que se intentó enviar, aunque el intento haya fallado';
    COMMENT ON COLUMN "envios_laboratorio"."destinatario_telefono" IS 'Teléfono exacto al que se intentó enviar por WhatsApp, aunque el intento haya fallado';
  `);
};

exports.down = function down(knex) {
  return knex.raw(`
    COMMENT ON COLUMN "envios_laboratorio"."destinatario_correo" IS NULL;
    COMMENT ON COLUMN "envios_laboratorio"."destinatario_telefono" IS NULL;
  `);
};
