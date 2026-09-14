// US WA 001: persistencia idempotente del webhook — hoy mensajes_whatsapp
// solo guarda la fila YA procesada (INSERT al final del flujo, con
// categoria_clasificacion/tokens ya resueltos). A partir de esta migración
// se inserta PENDIENTE en cuanto llega el webhook (antes de clasificar), y
// se completa con un UPDATE cuando termina de procesarse — por eso
// categoria_clasificacion y mensaje_recibido pasan a ser nullable
// (mensaje_recibido es NULL para tipos sin contenido interpretable, ver
// AC8 del US; se reutiliza esta misma columna como "contenido procesable"
// en vez de agregar una columna nueva).
//
// whatsapp_message_id es el wamid de Meta; UNIQUE lo hace idempotente ante
// reentregas (AC4) y ante una carrera real entre 2 webhooks concurrentes
// con el mismo wamid (AC5) — se resuelve con INSERT ... ON CONFLICT DO
// NOTHING en el repository, nunca con un SELECT previo (instrucción
// explícita del US). Nullable a propósito: Postgres no considera dos NULL
// iguales entre sí para efectos de UNIQUE, así que las filas históricas
// (que nunca tuvieron wamid, el flujo viejo no lo guardaba) conviven sin
// chocar; no hay forma honesta de rellenarlo retroactivamente (el payload
// original de Meta nunca se guardó completo).
//
// Sin CHECK constraints en direccion/estado_procesamiento/tipo_mensaje —
// mismo criterio ya usado en esta tabla para categoria_clasificacion:
// documentar los valores válidos vía COMMENT ON COLUMN, no con una
// restricción rígida que exija otra migración cada vez que se agregue un
// valor nuevo (Meta puede sumar tipos de mensaje; este US puede sumar
// estados de procesamiento).
//
// conversacion_id se agrega SIN FK a propósito: la tabla de conversaciones
// (agrupación de mensajes) es de una historia futura — aquí solo se
// reserva la columna, sin usarla todavía.
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

  // Backfill de lo histórico (todo insertado por el flujo viejo, que
  // SIEMPRE clasificaba y enviaba antes de insertar) — estas filas ya
  // están completamente procesadas, nunca deben quedar 'pendiente' para
  // que el worker nuevo no intente reprocesarlas ni reclasificarlas.
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
