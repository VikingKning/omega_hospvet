// US WA 003: consolidación de los fragmentos de una conversaciones_whatsapp
// tras vencer su ventana de agrupación. `group_id` es el nombre literal
// que pide la consideración técnica (no "id") — mismo criterio que
// created_at/updated_at en inglés en conversaciones_whatsapp: se sigue
// tal cual, sin "corregir" al resto del schema.
//
// Índice único parcial (conversacion_id) WHERE estado='pendiente_enrutamiento'
// es el mecanismo de idempotencia de AC12/AC13: a lo más un grupo sin
// enrutar por conversación — un reintento tras un crash reutiliza el
// mismo grupo en vez de crear uno duplicado.
//
// Sin CHECK constraint en `estado` — mismo criterio ya establecido en
// mensajes_whatsapp/conversaciones_whatsapp (documentar los valores
// válidos vía COMMENT ON COLUMN).
exports.up = async function up(knex) {
  await knex.schema.createTable('grupos_whatsapp', (table) => {
    table.increments('group_id').primary();
    table
      .integer('conversacion_id')
      .notNullable()
      .references('id')
      .inTable('conversaciones_whatsapp')
      .deferrable('immediate');
    table.text('texto_consolidado').notNullable();
    table.string('estado', 30).notNullable().defaultTo('pendiente_enrutamiento');
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('procesado_en', { useTz: true });
  });

  await knex.raw(`
    CREATE UNIQUE INDEX grupos_whatsapp_pendiente_enrutamiento_unique
      ON grupos_whatsapp (conversacion_id)
      WHERE estado = 'pendiente_enrutamiento';

    COMMENT ON TABLE "grupos_whatsapp" IS 'Consolidación de los fragmentos de una conversaciones_whatsapp tras vencer su ventana de agrupación (US WA 003).';
    COMMENT ON COLUMN "grupos_whatsapp"."estado" IS 'pendiente_enrutamiento (único valor emitido por US WA 003; el enrutamiento real es de una historia futura)';
  `);
};

exports.down = function down(knex) {
  return knex.schema.dropTable('grupos_whatsapp');
};
