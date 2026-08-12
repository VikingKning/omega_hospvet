exports.up = function up(knex) {
  return knex.schema
    .createTable('plantillas_whatsapp', (table) => {
      table.increments('id').primary();
      table.string('intencion', 100).notNullable().unique();
      table.text('texto_respuesta').notNullable();
      table.boolean('activo').notNullable().defaultTo(true);
      table.integer('veces_usada').notNullable().defaultTo(0);
      table.integer('creado_por');
      table.timestamp('creado_en', { useTz: true }).notNullable();
      table.integer('actualizado_por');
      table.timestamp('actualizado_en', { useTz: true });
      table.integer('desactivado_por');
      table.timestamp('desactivado_en', { useTz: true });
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "plantillas_whatsapp" IS 'Respuestas fijas y pre-aprobadas; el LLM nunca genera este texto libremente.'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('plantillas_whatsapp');
};
