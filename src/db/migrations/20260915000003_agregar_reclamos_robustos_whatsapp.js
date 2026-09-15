// Endurece los workers de WhatsApp con marcas de reclamación recuperables.
// Las marcas son independientes del resultado definitivo: evitan trabajo
// concurrente duplicado sin dejar filas bloqueadas después de reiniciar PM2.
exports.up = async function up(knex) {
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.string('clasificacion_reclamo_id', 64);
    table.timestamp('clasificacion_reclamada_en', { useTz: true });
  });

  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.timestamp('recordatorio_reclamado_en', { useTz: true });
  });

  await knex.schema.alterTable('solicitudes_atencion_humana', (table) => {
    table.timestamp('reintentar_despues_de', { useTz: true });
  });

  await knex.raw(`
    COMMENT ON COLUMN "grupos_whatsapp"."clasificacion_reclamo_id" IS 'Lease del worker autorizado para llamar a Claude para este grupo.';
    COMMENT ON COLUMN "grupos_whatsapp"."clasificacion_reclamada_en" IS 'Inicio del lease de clasificación; permite recuperar un worker interrumpido.';
    COMMENT ON COLUMN "conversaciones_whatsapp"."recordatorio_reclamado_en" IS 'Lease del worker de seguimiento; no significa que Meta haya aceptado el recordatorio.';
    COMMENT ON COLUMN "solicitudes_atencion_humana"."reintentar_despues_de" IS 'Backoff persistente de una transferencia fallida.';

    CREATE INDEX solicitudes_atencion_humana_reintento_idx
      ON solicitudes_atencion_humana (reintentar_despues_de)
      WHERE estado = 'fallida_reintentable';
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS solicitudes_atencion_humana_reintento_idx');
  await knex.schema.alterTable('solicitudes_atencion_humana', (table) => {
    table.dropColumn('reintentar_despues_de');
  });
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.dropColumn('recordatorio_reclamado_en');
  });
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.dropColumn('clasificacion_reclamo_id');
    table.dropColumn('clasificacion_reclamada_en');
  });
};
