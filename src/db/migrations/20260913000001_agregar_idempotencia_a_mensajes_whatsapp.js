exports.up = async function up(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.string('whatsapp_message_id', 255);
    table.string('tipo_mensaje', 30);
    table.string('media_id', 255);
    table.string('direccion', 10).notNullable().defaultTo('entrante');
    table.string('estado_procesamiento', 20).notNullable().defaultTo('pendiente');
    table.timestamp('procesando_desde', { useTz: true });
    table.integer('conversacion_id');

    table.unique('whatsapp_message_id');
  });

  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.text('mensaje_recibido').nullable().alter();
    table.string('categoria_clasificacion', 30).nullable().alter();
    table.integer('tokens_entrada').notNullable().defaultTo(0).alter();
    table.integer('tokens_salida').notNullable().defaultTo(0).alter();
  });

  await knex.raw(`
    COMMENT ON COLUMN "mensajes_whatsapp"."whatsapp_message_id" IS 'wamid de Meta (messages[].id). NULL solo en filas históricas anteriores a esta migración.';
    COMMENT ON COLUMN "mensajes_whatsapp"."estado_procesamiento" IS 'pendiente (recién persistido) | procesando (reclamado por un worker) | procesado | error (falló la clasificación misma)';
    COMMENT ON COLUMN "mensajes_whatsapp"."direccion" IS 'entrante | saliente — hoy esta tabla solo guarda entrantes; saliente queda reservado a futuro.';
  `);

  await knex('mensajes_whatsapp')
    .whereNotNull('procesado_en')
    .update({ estado_procesamiento: 'procesado', direccion: 'entrante' });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.dropUnique('whatsapp_message_id');
    table.dropColumn('whatsapp_message_id');
    table.dropColumn('tipo_mensaje');
    table.dropColumn('media_id');
    table.dropColumn('direccion');
    table.dropColumn('estado_procesamiento');
    table.dropColumn('procesando_desde');
    table.dropColumn('conversacion_id');
  });
  await knex.schema.alterTable('mensajes_whatsapp', (table) => {
    table.text('mensaje_recibido').notNullable().alter();
    table.string('categoria_clasificacion', 30).notNullable().alter();
  });
};
