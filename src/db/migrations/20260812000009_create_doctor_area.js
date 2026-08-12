exports.up = function up(knex) {
  return knex.schema
    .createTable('doctor_area', (table) => {
      table.increments('id').primary();
      table.integer('doctor_id').notNullable();
      table.integer('area_id').notNullable();
      table.unique(['doctor_id', 'area_id']);
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "doctor_area" IS 'Muchos a muchos: un doctor puede atender varias áreas (2.6.3).'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('doctor_area');
};
