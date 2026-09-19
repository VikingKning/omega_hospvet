exports.up = async function up(knex) {
  await knex.schema.alterTable('usuarios', (table) => {
    table.string('tipo_usuario', 20).notNullable().defaultTo('usuario');
    table.boolean('notificaciones_alertas').notNullable().defaultTo(false);
  });

  await knex('usuarios').whereNotNull('doctor_id').update({ tipo_usuario: 'doctor' });

  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_usuario_check
      CHECK (tipo_usuario IN ('doctor', 'estilista', 'recepcion', 'usuario'))
  `);
  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_doctor_vinculo_check
      CHECK (
        (doctor_id IS NOT NULL AND tipo_usuario = 'doctor') OR
        (doctor_id IS NULL AND tipo_usuario <> 'doctor')
      )
  `);
  await knex.raw(`
    COMMENT ON COLUMN usuarios.tipo_usuario IS
      'Rol operativo: doctor cuando doctor_id tiene valor; estilista, recepcion o usuario en cuentas sin doctor.'
  `);
  await knex.raw(`
    COMMENT ON COLUMN usuarios.notificaciones_alertas IS
      'Indica si la cuenta recibe alertas operativas y de emergencia.'
  `);
};

exports.down = async function down(knex) {
  await knex.raw(
    'ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_doctor_vinculo_check',
  );
  await knex.raw('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_usuario_check');
  await knex.schema.alterTable('usuarios', (table) => {
    table.dropColumn('notificaciones_alertas');
    table.dropColumn('tipo_usuario');
  });
};
