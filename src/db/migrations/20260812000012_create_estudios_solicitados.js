exports.up = function up(knex) {
  return knex.schema
    .createTable('estudios_solicitados', (table) => {
      table.increments('id').primary();
      table.integer('registro_laboratorio_id').notNullable();
      table.integer('estudio_id').notNullable();
      table.integer('zona_anatomica_id');
      table.integer('archivo_id');
      table.string('estado', 20).notNullable();
      table.timestamp('creado_en', { useTz: true }).notNullable();
    })
    .then(() =>
      knex.raw(`
    COMMENT ON TABLE "estudios_solicitados" IS 'Detalle de estudios (2.4.1). archivo_id permite que varios estudios compartan un mismo archivo consolidado.';
    COMMENT ON COLUMN "estudios_solicitados"."estado" IS 'pendiente | enviado';
  `),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('estudios_solicitados');
};
