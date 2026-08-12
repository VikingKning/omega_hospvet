exports.up = function up(knex) {
  return knex.schema
    .createTable('archivos_laboratorio', (table) => {
      table.increments('id').primary();
      table.integer('registro_laboratorio_id').notNullable();
      table.string('nombre_original', 255).notNullable();
      table.string('ruta_almacenamiento', 500).notNullable();
      table.string('hash_contenido', 64).notNullable();
      table.integer('tamano_bytes').notNullable();
      table.boolean('consolidado').notNullable().defaultTo(false);
      table.integer('cargado_por').notNullable();
      table.timestamp('cargado_en', { useTz: true }).notNullable();
      table.index('hash_contenido');
    })
    .then(() =>
      knex.raw(`
    COMMENT ON COLUMN "archivos_laboratorio"."hash_contenido" IS 'SHA-256, indexado para validación global de duplicados';
    COMMENT ON COLUMN "archivos_laboratorio"."consolidado" IS 'true = PDF generado por el sistema fusionando varios archivos del mismo registro';
  `),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('archivos_laboratorio');
};
