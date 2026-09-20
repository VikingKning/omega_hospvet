exports.up = async function up(knex) {
  await knex.schema.createTable('consentimiento_lfpdppp', (table) => {
    table.increments('id').primary();
    table.string('telefono', 20).notNullable();
    table
      .integer('propietario_id')
      .nullable()
      .references('id')
      .inTable('propietarios')
      .onDelete('SET NULL');
    table.boolean('acepto').nullable();
    table.string('canal', 20).notNullable().defaultTo('whatsapp');
    table.string('wamid', 255).nullable();
    table.string('version_aviso', 50).nullable();
    table.timestamp('aviso_enviado_en', { useTz: true }).nullable();
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['telefono', 'creado_en']);
  });

  await knex.raw(`
    ALTER TABLE consentimiento_lfpdppp
      ADD CONSTRAINT consentimiento_lfpdppp_canal_check
      CHECK (canal IN ('whatsapp', 'panel'));
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('consentimiento_lfpdppp');
};
