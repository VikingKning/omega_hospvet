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

// US-106 PASO 6: contraseña incorrecta — incrementa el contador y, solo si
// cruza exactamente un umbral (5, 10, o 15+), escala `estatus` y marca
// `bloqueado_en`. En cualquier otro valor (1-4, 6-9, 11-14) solo incrementa:
// un bloqueo temporal que ya expiró no se "reactiva" por un intento más,
// hasta el siguiente múltiplo de 5 (así lo especifica el AC: "si después de
// finalizar dicho bloqueo acumula OTROS 5 intentos...").
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

// US-106 PASO 5: contraseña correcta — resetea el contador/estatus a cero y
// registra el último login, todo en un solo UPDATE.
async function resetIntentosYLogin(usuarioId) {
  await db('usuarios').where({ id: usuarioId }).update({
    estatus: 'activo',
    intentos_fallidos: 0,
    bloqueado_en: null,
    ultimo_login_en: db.fn.now(),
  });
}

// US-605 AC: contraseña TEMPORAL incorrecta durante estatus='cambio_pwd' —
// contador propio, independiente del de registrarIntentoFallido(). El AC
// pide un umbral único (5 intentos -> bloqueado directo), sin el paso
// intermedio de bloqueo_temp (15/30 min) que sí aplica al login normal —
// por eso es una función separada y no una reutilización de la de arriba.
async function registrarIntentoFallidoCambioPwd(usuarioId, intentosActuales) {
  const nuevosIntentos = intentosActuales + 1;
  const update = { intentos_fallidos: nuevosIntentos };

  if (nuevosIntentos >= 5) {
    update.estatus = 'bloqueado';
    update.bloqueado_en = db.fn.now();
  }

  await db('usuarios').where({ id: usuarioId }).update(update);
}

// US-605 AC: contraseña temporal correcta — a diferencia de
// resetIntentosYLogin(), NO cambia estatus a 'activo' (el usuario sigue en
// cambio_pwd hasta completar el cambio obligatorio, ver
// completarCambioPassword) — solo limpia el contador de intentos fallidos
// y registra el login.
async function resetIntentosCambioPwd(usuarioId) {
  await db('usuarios').where({ id: usuarioId }).update({
    intentos_fallidos: 0,
    bloqueado_en: null,
    ultimo_login_en: db.fn.now(),
  });
}

// US-605 AC: cambio obligatorio completado — actualiza password_hash,
// vuelve estatus='activo', resetea intentos_fallidos/bloqueado_en (mismo
// criterio que cualquier otra transición hacia 'activo', ver
// usuarios.repository.js#update) y registra actualizado_por/actualizado_en
// con el propio usuario (es el único caso de todo el sistema donde
// actualizado_por = el mismo id que se está actualizando).
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
