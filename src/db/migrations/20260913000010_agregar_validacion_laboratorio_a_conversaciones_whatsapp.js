exports.up = async function up(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.integer('intentos_validacion_lab');
  });
  await knex.raw(`
    COMMENT ON COLUMN "conversaciones_whatsapp"."intentos_validacion_lab" IS 'US WA 007 (AC10): intentos fallidos de validar folio+teléfono durante flujo_actual=consulta_laboratorio. NULL equivale a 0; se reinicia al entrar al flujo, se limpia al salir.';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.dropColumn('intentos_validacion_lab');
  });
};
