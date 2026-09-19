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

async function registrarIntentoFallido(usuarioId, intentosActuales) {
  const nuevosIntentos = intentosActuales + 1;
  const update = { intentos_fallidos: nuevosIntentos };

  if (nuevosIntentos === 5 || nuevosIntentos === 10) {
    update.estatus = 'bloqueo_temp';
    update.bloqueado_en = db.fn.now();
  } else if (nuevosIntentos >= 15) {
    update.estatus = 'bloqueado';
    update.bloqueado_en = db.fn.now();
  }

  await db('usuarios').where({ id: usuarioId }).update(update);
}

async function resetIntentosYLogin(usuarioId) {
  await db('usuarios').where({ id: usuarioId }).update({
    estatus: 'activo',
    intentos_fallidos: 0,
    bloqueado_en: null,
    ultimo_login_en: db.fn.now(),
  });
}

async function registrarIntentoFallidoCambioPwd(usuarioId, intentosActuales) {
  const nuevosIntentos = intentosActuales + 1;
  const update = { intentos_fallidos: nuevosIntentos };

  if (nuevosIntentos >= 5) {
    update.estatus = 'bloqueado';
    update.bloqueado_en = db.fn.now();
  }

  await db('usuarios').where({ id: usuarioId }).update(update);
}

async function resetIntentosCambioPwd(usuarioId) {
  await db('usuarios').where({ id: usuarioId }).update({
    intentos_fallidos: 0,
    bloqueado_en: null,
    ultimo_login_en: db.fn.now(),
  });
}

async function completarCambioPassword(usuarioId, passwordHash) {
  await db('usuarios').where({ id: usuarioId }).update({
    password_hash: passwordHash,
    estatus: 'activo',
    intentos_fallidos: 0,
    bloqueado_en: null,
    actualizado_por: usuarioId,
    actualizado_en: db.fn.now(),
  });
}

module.exports = {
  findByUsername,
  getPermissionCodes,
  registrarIntentoFallido,
  resetIntentosYLogin,
  registrarIntentoFallidoCambioPwd,
  resetIntentosCambioPwd,
  completarCambioPassword,
};
