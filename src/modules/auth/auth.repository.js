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

module.exports = {
  findByUsername,
  getPermissionCodes,
  registrarIntentoFallido,
  resetIntentosYLogin,
};
