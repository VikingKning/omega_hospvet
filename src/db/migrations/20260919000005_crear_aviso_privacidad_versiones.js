exports.up = async function up(knex) {
  await knex.schema.createTable('aviso_privacidad_versiones', (table) => {
    table.increments('id').primary();
    table.string('version', 50).notNullable();
    table.string('nombre_archivo', 255).notNullable().unique();
    table.string('nombre_original', 255).notNullable();
    table
      .integer('subido_por')
      .nullable()
      .references('id')
      .inTable('usuarios')
      .onDelete('SET NULL');
    table.timestamp('creado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('aviso_privacidad_versiones');
};
