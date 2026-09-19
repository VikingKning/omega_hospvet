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
