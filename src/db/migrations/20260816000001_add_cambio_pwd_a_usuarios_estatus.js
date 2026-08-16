// US-605: agrega 'cambio_pwd' a los valores permitidos de usuarios.estatus
// — el estatus que toma un usuario tras un restablecimiento de contraseña
// administrativo, mientras no haya completado el cambio obligatorio.
// Espeja el cambio en `assets/sql/Omega-Database.sql` (la fuente de verdad
// del schema del cliente), mismo criterio que la migración original de
// US-106 que creó este mismo constraint.
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
