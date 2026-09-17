exports.up = async function up(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.string('mime_type', 100);
  });
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table
      .integer('grupo_origen_id')
      .references('group_id')
      .inTable('grupos_whatsapp')
      .deferrable('immediate');
  });
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table
      .integer('grupo_medio_pendiente_id')
      .references('group_id')
      .inTable('grupos_whatsapp')
      .deferrable('immediate');
  });

  await knex.raw(`
    COMMENT ON COLUMN "mensajes_whatsapp"."mime_type" IS 'MIME type que Meta reporta para medios (image/video/audio/document/sticker) — US WA 014. NULL para tipos sin media (text, interactive_*, location, etc.).';
    COMMENT ON COLUMN "mensajes_whatsapp"."estado_procesamiento" IS 'pendiente (recién persistido) | procesando (reclamado por un worker) | procesado | error (falló la clasificación misma) | no_interpretable_bot (medio agrupado sin explicación escrita, US WA 014)';
    COMMENT ON COLUMN "grupos_whatsapp"."estado" IS 'pendiente_enrutamiento (esperando que una historia futura de enrutamiento lo procese) | procesado (US WA 014: grupo de solo medios, ya se envió la solicitud de explicación)';
    COMMENT ON COLUMN "grupos_whatsapp"."grupo_origen_id" IS 'US WA 014 (AC5/AC6): cuando este grupo es la explicación escrita de un grupo de medios previo, apunta a ese grupo original. NULL en cualquier otro caso.';
    COMMENT ON COLUMN "conversaciones_whatsapp"."grupo_medio_pendiente_id" IS 'US WA 014 (AC4): mientras estado=flujo_activo y paso_actual=esperando_descripcion, referencia al grupo de medios que originó la solicitud de explicación. Se limpia al resolverse (AC6) o al reemplazarse por un grupo de medios más reciente.';
    COMMENT ON COLUMN "conversaciones_whatsapp"."flujo_actual" IS 'US WA 014: explicacion_medio es el único valor emitido hasta ahora (ver paso_actual).';
    COMMENT ON COLUMN "conversaciones_whatsapp"."paso_actual" IS 'US WA 014: esperando_descripcion es el único valor emitido hasta ahora (ver flujo_actual=explicacion_medio).';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('conversaciones_whatsapp', (table) => {
    table.dropColumn('grupo_medio_pendiente_id');
  });
  await knex.schema.alterTable('grupos_whatsapp', (table) => {
    table.dropColumn('grupo_origen_id');
  });
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.dropColumn('mime_type');
  });
};
