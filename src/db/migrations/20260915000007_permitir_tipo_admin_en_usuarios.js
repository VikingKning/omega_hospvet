// Pedido explícito del usuario: permitir 'admin' como valor de
// usuarios.tipo_usuario ÚNICAMENTE a nivel de base de datos — sin tocar
// TIPOS_USUARIO en usuarios.service.js ni el toggle de usuario-form.ejs
// (ambos siguen sin ofrecer 'admin' desde la interfaz). tipo_usuario es
// solo la etiqueta de rol operativo (migración 20260915000005) y no tiene
// relación con el sistema real de permisos (usuario_permisos) — sigue
// siendo necesario asignar los permisos por separado para que la cuenta
// tenga acceso completo.
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_usuario_check');
  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_usuario_check
      CHECK (tipo_usuario IN ('doctor', 'estilista', 'recepcion', 'usuario', 'admin'))
  `);
};

exports.down = async function down(knex) {
  // Antes de restaurar la regla anterior, cualquier cuenta 'admin' vuelve
  // al tipo neutral para que el rollback no falle.
  await knex('usuarios').where({ tipo_usuario: 'admin' }).update({ tipo_usuario: 'usuario' });
  await knex.raw('ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_usuario_check');
  await knex.raw(`
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_tipo_usuario_check
      CHECK (tipo_usuario IN ('doctor', 'estilista', 'recepcion', 'usuario'))
  `);
};
