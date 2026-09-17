exports.up = async function up(knex) {
  await knex.schema.createTable('emergencias_confirmadas', (table) => {
    table.increments('id').primary();
    table
      .integer('conversacion_id')
      .notNullable()
      .references('id')
      .inTable('conversaciones_whatsapp')
      .deferrable('immediate');
    table
      .integer('group_id')
      .notNullable()
      .unique()
      .references('group_id')
      .inTable('grupos_whatsapp')
      .deferrable('immediate');
    table
      .integer('plantilla_id')
      .notNullable()
      .references('id')
      .inTable('plantillas_whatsapp')
      .deferrable('immediate');
    table.string('slug', 150).notNullable();
    table.boolean('es_emergencia').notNullable().defaultTo(true);
    table.text('respuesta_definitiva').notNullable();
    table
      .integer('intento_envio_id')
      .references('intent_id')
      .inTable('outbox_whatsapp')
      .deferrable('immediate');
    table.timestamp('confirmado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    COMMENT ON TABLE "emergencias_confirmadas" IS 'Señal idempotente de emergencia confirmada (US WA 009 AC13/AC22/AC24) — contrato para que la US WA 016 genere el banner/notificaciones al personal; esta historia no lo hace.';
  `);
};

exports.down = function down(knex) {
  return knex.schema.dropTable('emergencias_confirmadas');
};
