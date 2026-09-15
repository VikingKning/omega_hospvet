// US WA 009: conecta finalmente el grupo consolidado (US WA 003) con la
// clasificación de Claude — consideración técnica: "Persistir por grupo
// como mínimo plantilla_id, slug_resuelto, es_emergencia_resuelta,
// respuesta_definitiva, clasificado_en y la referencia a la intención de
// envío". `es_emergencia_resuelta` es una COPIA inmutable del valor de
// plantillas_whatsapp.es_emergencia al momento de clasificar (AC22) — un
// cambio posterior al switch de la plantilla nunca debe alterar esta fila
// histórica. `tokens_entrada`/`tokens_salida` van aquí (no en
// mensajes_whatsapp): un grupo puede consolidar varios mensajes en una sola
// llamada a Claude (AC6), así que el consumo real pertenece al grupo, no a
// un mensaje individual — consideración técnica: "registrar el consumo
// real cuando Claude procese el texto consolidado".
exports.up = async function up(knex) {
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table
      .integer('plantilla_id')
      .references('id')
      .inTable('plantillas_whatsapp')
      .deferrable('immediate');
    table.string('slug_resuelto', 150);
    table.boolean('es_emergencia_resuelta');
    table.text('respuesta_definitiva');
    table.timestamp('clasificado_en', { useTz: true });
    table
      .integer('intento_envio_id')
      .references('intent_id')
      .inTable('outbox_whatsapp')
      .deferrable('immediate');
    table.integer('tokens_entrada');
    table.integer('tokens_salida');
  });
  await knex.raw(`
    COMMENT ON COLUMN "grupos_whatsapp"."slug_resuelto" IS 'Slug que devolvió Claude para este grupo (US WA 009 AC10/AC11) — se conserva tal cual aunque no haya resuelto ninguna plantilla utilizable (AC18), para auditoría.';
    COMMENT ON COLUMN "grupos_whatsapp"."es_emergencia_resuelta" IS 'Copia INMUTABLE de plantillas_whatsapp.es_emergencia al momento de clasificar (US WA 009 AC12/AC22) — un cambio posterior al switch de la plantilla nunca altera esta fila histórica.';
    COMMENT ON COLUMN "grupos_whatsapp"."clasificado_en" IS 'Cuándo se clasificó este grupo — NULL significa que todavía no se ha llamado a Claude para él; un reintento nunca vuelve a llamarlo si ya tiene valor (US WA 009 AC26).';
    COMMENT ON COLUMN "grupos_whatsapp"."intento_envio_id" IS 'outbox_whatsapp.intent_id de la respuesta clínica definitiva (US WA 009, "la referencia a la intención de envío") — un reintento reutiliza este mismo intento, nunca clasifica ni registra otro.';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.dropColumn('plantilla_id');
    table.dropColumn('slug_resuelto');
    table.dropColumn('es_emergencia_resuelta');
    table.dropColumn('respuesta_definitiva');
    table.dropColumn('clasificado_en');
    table.dropColumn('intento_envio_id');
    table.dropColumn('tokens_entrada');
    table.dropColumn('tokens_salida');
  });
};
