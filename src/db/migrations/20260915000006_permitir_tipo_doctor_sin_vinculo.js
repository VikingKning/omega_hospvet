exports.up = async function up(knex) {
  await knex.raw(
    'ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_doctor_vinculo_check',
  );
  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_doctor_vinculo_check
      CHECK (doctor_id IS NULL OR tipo_usuario = 'doctor')
  `);
};

exports.down = async function down(knex) {
  // Antes de restaurar la regla anterior, las cuentas Doctor sin vínculo
  // vuelven al tipo neutral para que el rollback no falle.
  await knex('usuarios')
    .whereNull('doctor_id')
    .where({ tipo_usuario: 'doctor' })
    .update({ tipo_usuario: 'usuario' });

  await knex.raw(
    'ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_doctor_vinculo_check',
  );
  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_doctor_vinculo_check
      CHECK (
        (doctor_id IS NOT NULL AND tipo_usuario = 'doctor') OR
        (doctor_id IS NULL AND tipo_usuario <> 'doctor')
      )
  `);
};
