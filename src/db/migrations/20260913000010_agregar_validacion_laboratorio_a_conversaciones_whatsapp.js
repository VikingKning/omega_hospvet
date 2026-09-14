// US WA 007: contador de intentos fallidos de validación de identidad
// (folio + teléfono) para la consulta de resultados de laboratorio por
// WhatsApp — AC10 ("límite configurable de intentos fallidos"). Vive en
// conversaciones_whatsapp (no en una tabla de auditoría aparte: la
// consideración técnica pide loguear el resultado de cada intento, no
// persistir un historial consultable) y solo tiene significado mientras
// flujo_actual='consulta_laboratorio'.
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
