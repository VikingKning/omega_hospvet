exports.up = function up(knex) {
  return knex.schema
    .createTable('usuarios', (table) => {
      table.increments('id').primary();
      table.string('nombre', 100).notNullable();
      table.string('apellidos', 100).notNullable();
      table.string('correo', 150).notNullable().unique();
      table.string('telefono', 20);
      table.string('username', 50).notNullable().unique();
      table.string('password_hash', 255).notNullable();
      table.integer('doctor_id');
      table.boolean('activo').notNullable().defaultTo(true);
      table.timestamp('ultimo_login_en', { useTz: true });
      table.integer('creado_por');
      table.timestamp('creado_en', { useTz: true }).notNullable();
      table.integer('actualizado_por');
      table.timestamp('actualizado_en', { useTz: true });
      table.integer('desactivado_por');
      table.timestamp('desactivado_en', { useTz: true });
    })
    .then(() =>
      knex.raw(
        `COMMENT ON TABLE "usuarios" IS 'Cuentas de acceso al panel. doctor_id es opcional y en un solo sentido (2.6.3).'`,
      ),
    );
};

exports.down = function down(knex) {
  return knex.schema.dropTable('usuarios');
};
