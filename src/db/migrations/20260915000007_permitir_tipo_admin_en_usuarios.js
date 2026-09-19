exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_usuario_check');
  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_usuario_check
      CHECK (tipo_usuario IN ('doctor', 'estilista', 'recepcion', 'usuario', 'admin'))
  `);
};

exports.down = async function down(knex) {
  await knex('usuarios').where({ tipo_usuario: 'admin' }).update({ tipo_usuario: 'usuario' });
  await knex.raw('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_usuario_check');
  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_usuario_check
      CHECK (tipo_usuario IN ('doctor', 'estilista', 'recepcion', 'usuario'))
  `);
};
