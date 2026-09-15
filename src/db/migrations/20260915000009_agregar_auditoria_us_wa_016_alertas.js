// US WA 016: la solicitud de alerta de emergencia conserva su prioridad y
// sus propios contadores deterministas. Los tokens pertenecen a esta etapa
// de generación de alerta (siempre cero), no a la clasificación WA009.
exports.up = async function up(knex) {
  await knex.schema.alterTable('alertas_atencion_whatsapp', (table) => {
    table.string('prioridad', 20);
    table.integer('tokens_entrada').notNullable().defaultTo(0);
    table.integer('tokens_salida').notNullable().defaultTo(0);
  });

  await knex.raw(`
    ALTER TABLE alertas_atencion_whatsapp
      ADD CONSTRAINT alertas_atencion_whatsapp_prioridad_check
      CHECK (prioridad IS NULL OR prioridad IN ('critica')),
      ADD CONSTRAINT alertas_atencion_whatsapp_tokens_check
      CHECK (tokens_entrada >= 0 AND tokens_salida >= 0);

    COMMENT ON COLUMN alertas_atencion_whatsapp.prioridad IS 'Prioridad de la solicitud original; critica para alertas generadas por US WA 016.';
    COMMENT ON COLUMN alertas_atencion_whatsapp.tokens_entrada IS 'Tokens consumidos por la generación determinista de la alerta; US WA 016 y WA 019 registran cero.';
    COMMENT ON COLUMN alertas_atencion_whatsapp.tokens_salida IS 'Tokens producidos por la generación determinista de la alerta; US WA 016 y WA 019 registran cero.';
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE alertas_atencion_whatsapp
      DROP CONSTRAINT alertas_atencion_whatsapp_prioridad_check,
      DROP CONSTRAINT alertas_atencion_whatsapp_tokens_check;
  `);
  await knex.schema.alterTable('alertas_atencion_whatsapp', (table) => {
    table.dropColumn('tokens_salida');
    table.dropColumn('tokens_entrada');
    table.dropColumn('prioridad');
  });
};
