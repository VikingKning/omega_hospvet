// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias).
const db = require('../../config/database');

function findByUsername(username) {
  return db('usuarios').where({ username }).first();
}

async function getPermissionCodes(usuarioId) {
  const rows = await db('usuario_permisos')
    .join('permissions', 'permissions.id', 'usuario_permisos.permission_id')
    .where('usuario_permisos.usuario_id', usuarioId)
    .select('permissions.codigo');

  return rows.map((row) => row.codigo);
}

function touchLastLogin(usuarioId) {
  return db('usuarios').where({ id: usuarioId }).update({ ultimo_login_en: db.fn.now() });
}

module.exports = { findByUsername, getPermissionCodes, touchLastLogin };
