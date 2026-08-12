exports.up = function up(knex) {
  return knex.schema
    .createTable('envio_archivo', (table) => {
      table.increments('id').primary();
      table.integer('envio_id').notNullable();
      table.integer('archivo_id').notNullable();
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "envio_archivo" IS 'Puente envío↔archivo; permite reenviar el mismo archivo en envíos posteriores.'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('envio_archivo');
};
