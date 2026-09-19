exports.up = async function up(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.timestamp('procesamiento_iniciado_en', { useTz: true });
  });
  await knex.raw(`
    COMMENT ON COLUMN "conversaciones_whatsapp"."procesamiento_iniciado_en" IS 'Marca de cuándo un worker reclamó esta conversación (estado=procesando) — permite recuperar una reclamación abandonada (US WA 003, AC13).';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.dropColumn('procesamiento_iniciado_en');
  });
};
