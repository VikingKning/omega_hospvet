exports.up = function up(knex) {
  return knex.schema
    .createTable('envios_laboratorio', (table) => {
      table.increments('id').primary();
      table.integer('registro_laboratorio_id').notNullable();
      table.string('medio', 20).notNullable();
      table.string('destinatario_correo', 150);
      table.string('destinatario_telefono', 20);
      table.integer('enviado_por').notNullable();
      table.timestamp('enviado_en', { useTz: true }).notNullable();
    })
    .then(() =>
      knex.raw(`
    COMMENT ON TABLE "envios_laboratorio" IS 'destinatario_correo/telefono son una fotografía del dato de contacto al momento del envío (no cambian si el tutor corrige sus datos después).';
    COMMENT ON COLUMN "envios_laboratorio"."medio" IS 'correo | whatsapp | ambos';
  `),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('envios_laboratorio');
};
