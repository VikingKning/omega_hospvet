// US WA 018: auditoría central de alertas internas derivadas de una
// conversación de WhatsApp. Su ciclo de vida es independiente del estado
// de conversaciones_whatsapp y nunca se elimina al vencer la atención
// humana del bot.
exports.up = async function up(knex) {
  await knex.schema.createTable('alertas_atencion_whatsapp', (table) => {
    table.increments('id').primary();
    table.string('clave_idempotencia', 255).notNullable().unique();
    table.string('tipo_alerta', 20).notNullable();
    table
      .integer('conversacion_id')
      .notNullable()
      .references('id')
      .inTable('conversaciones_whatsapp');
    table.integer('grupo_id').references('group_id').inTable('grupos_whatsapp');
    table.integer('mensaje_origen_id').references('id').inTable('mensajes_whatsapp');
    table.string('whatsapp_message_id_origen', 255);
    table.string('telefono_externo', 20);
    table.string('origen', 50).notNullable();
    table.string('estado', 20).notNullable().defaultTo('pendiente');
    table.string('resolucion_destinatarios', 30).notNullable().defaultTo('pendiente');
    table.integer('atendida_por').references('id').inTable('usuarios');
    table.timestamp('atendida_en', { useTz: true });
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('destinatarios_alerta_whatsapp', (table) => {
    table.increments('id').primary();
    table.integer('alerta_id').notNullable().references('id').inTable('alertas_atencion_whatsapp');
    table.integer('usuario_id').notNullable().references('id').inTable('usuarios');
    table.string('tipo_usuario', 20).notNullable();
    table.boolean('notificaciones_alertas').notNullable();
    table.string('telefono_normalizado', 20);
    table.boolean('es_respaldo_admin').notNullable().defaultTo(false);
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['alerta_id', 'usuario_id']);
  });

  await knex.schema.createTable('intentos_alerta_whatsapp', (table) => {
    table.increments('id').primary();
    table.string('clave_idempotencia', 255).notNullable().unique();
    table.integer('alerta_id').notNullable().references('id').inTable('alertas_atencion_whatsapp');
    table.integer('destinatario_id').references('id').inTable('destinatarios_alerta_whatsapp');
    table.string('canal', 20).notNullable();
    table.string('destino_normalizado', 100);
    table.integer('numero_intento').notNullable().defaultTo(0);
    table.string('estado', 30).notNullable().defaultTo('pendiente');
    table.string('identificador_externo', 255);
    table.text('error_tecnico');
    table.integer('outbox_id').references('intent_id').inTable('outbox_whatsapp');
    table.timestamp('intentado_en', { useTz: true });
    table.timestamp('proximo_intento_en', { useTz: true });
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE alertas_atencion_whatsapp
      ADD CONSTRAINT alertas_atencion_whatsapp_tipo_check
      CHECK (tipo_alerta IN ('emergencia', 'recepcion')),
      ADD CONSTRAINT alertas_atencion_whatsapp_estado_check
      CHECK (estado IN ('pendiente', 'atendida')),
      ADD CONSTRAINT alertas_atencion_whatsapp_atencion_check
      CHECK (
        (estado = 'pendiente' AND atendida_por IS NULL AND atendida_en IS NULL) OR
        (estado = 'atendida' AND atendida_por IS NOT NULL AND atendida_en IS NOT NULL)
      ),
      ADD CONSTRAINT alertas_atencion_whatsapp_resolucion_check
      CHECK (resolucion_destinatarios IN ('pendiente', 'principal', 'respaldo_admin', 'sin_destinatarios'));

    ALTER TABLE intentos_alerta_whatsapp
      ADD CONSTRAINT intentos_alerta_whatsapp_canal_check
      CHECK (canal IN ('portal', 'navegador', 'whatsapp')),
      ADD CONSTRAINT intentos_alerta_whatsapp_estado_check
      CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'fallido', 'no_aplicable', 'no_disponible'));

    CREATE INDEX alertas_atencion_whatsapp_pendientes_idx
      ON alertas_atencion_whatsapp (creado_en, id) WHERE estado = 'pendiente';
    CREATE INDEX alertas_atencion_whatsapp_conversacion_idx
      ON alertas_atencion_whatsapp (conversacion_id, creado_en DESC);
    CREATE INDEX destinatarios_alerta_whatsapp_usuario_idx
      ON destinatarios_alerta_whatsapp (usuario_id, alerta_id);
    CREATE INDEX intentos_alerta_whatsapp_alerta_canal_estado_idx
      ON intentos_alerta_whatsapp (alerta_id, canal, estado);
    CREATE UNIQUE INDEX intentos_alerta_whatsapp_telefono_unique
      ON intentos_alerta_whatsapp (alerta_id, canal, destino_normalizado)
      WHERE canal = 'whatsapp' AND destino_normalizado IS NOT NULL;

    COMMENT ON TABLE alertas_atencion_whatsapp IS 'Alertas internas pendientes o atendidas, independientes del vencimiento de la atención humana de la conversación (US WA 018).';
    COMMENT ON COLUMN alertas_atencion_whatsapp.resolucion_destinatarios IS 'principal | respaldo_admin | sin_destinatarios; conserva la decisión inicial aunque después cambien los usuarios.';
    COMMENT ON TABLE destinatarios_alerta_whatsapp IS 'Fotografía inmutable de los usuarios elegibles seleccionados al crear una alerta de atención de WhatsApp.';
    COMMENT ON TABLE intentos_alerta_whatsapp IS 'Auditoría funcional independiente por canal; outbox_id delega la entrega técnica de WhatsApp a US WA 015.';
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('intentos_alerta_whatsapp');
  await knex.schema.dropTable('destinatarios_alerta_whatsapp');
  await knex.schema.dropTable('alertas_atencion_whatsapp');
};
