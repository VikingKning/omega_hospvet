exports.up = function up(knex) {
  return knex.schema
    .createTable('password_reset_tokens', (table) => {
      table.increments('id').primary();
      table.integer('usuario_id').notNullable();
      table.string('token_hash', 255).notNullable();
      table.timestamp('expira_en', { useTz: true }).notNullable();
      table.timestamp('usado_en', { useTz: true });
      table.string('solicitado_desde_ip', 45).notNullable();
      table.timestamp('creado_en', { useTz: true }).notNullable();
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "password_reset_tokens" IS 'Recuperación de contraseña de un solo uso, expira a los 30 minutos (2.1.2).'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('password_reset_tokens');
};
