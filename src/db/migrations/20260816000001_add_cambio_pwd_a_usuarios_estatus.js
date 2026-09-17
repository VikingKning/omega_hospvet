exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_estatus_check"');
  await knex.raw(
    `ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_estatus_check" CHECK ("estatus" IN ('activo', 'bloqueo_temp', 'bloqueado', 'inactivo', 'cambio_pwd'))`,
  );
};

exports.down = async function down(knex) {
  await knex('usuarios').where({ estatus: 'cambio_pwd' }).update({ estatus: 'activo' });
  await knex.raw('ALTER TABLE "usuarios" DROP CONSTRAINT "usuarios_estatus_check"');
  await knex.raw(
    `ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_estatus_check" CHECK ("estatus" IN ('activo', 'bloqueo_temp', 'bloqueado', 'inactivo'))`,
  );
};
