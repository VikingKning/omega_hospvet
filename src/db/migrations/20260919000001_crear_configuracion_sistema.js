exports.up = async function up(knex) {
  await knex.schema.createTable('configuracion_sistema', (table) => {
    table.string('clave', 100).primary();
    table.text('valor').nullable();
    table.text('descripcion').nullable();
    table.timestamp('actualizado_en', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table
      .integer('actualizado_por')
      .nullable()
      .references('id')
      .inTable('usuarios')
      .onDelete('SET NULL');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('configuracion_sistema');
};
