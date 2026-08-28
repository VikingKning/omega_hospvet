// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1). Trabaja sobre `usuarios`, la misma
// tabla que usuarios.repository.js, pero deliberadamente NO la reutiliza
// (mismo criterio de independencia entre módulos ya aplicado en el resto
// del proyecto — auth.repository.js tampoco reusa usuarios.repository.js) —
// además este módulo solo necesita un subconjunto muy chico de columnas y
// una sola fila a la vez (siempre la del usuario en sesión).
const db = require('../../config/database');

// `estatus`/`ultimo_login_en` son para la tarjeta "Mi cuenta" (badge de
// estatus y último acceso) — de solo lectura, nunca se editan desde este
// módulo.
async function findById(id) {
  return db('usuarios')
    .where({ id })
    .first(
      'id',
      'nombre',
      'apellidos',
      'telefono',
      'correo',
      'username',
      'doctor_id',
      'estatus',
      'ultimo_login_en',
      'avatar',
    );
}

// Datos ligados a la cuenta (solo lectura, sin filtrar por activo — un
// vínculo/especialidad ya guardado no debe "desaparecer" del perfil solo
// porque el doctor o el área se dieron de baja después, mismo criterio que
// usuarios.repository.js#findDoctorVinculado/doctores.repository.js#findAreasByDoctorId).
async function findDoctorVinculado(doctorId) {
  if (!doctorId) return undefined;
  return db('doctores').where({ id: doctorId }).first('id', 'nombre', 'apellidos');
}

async function findAreasDelDoctor(doctorId) {
  if (!doctorId) return [];
  return db('doctor_area as da')
    .join('areas as a', 'a.id', 'da.area_id')
    .where('da.doctor_id', doctorId)
    .orderBy('a.nombre')
    .select('a.id', 'a.nombre');
}

// Catálogo completo de permisos posibles, para construir la matriz de solo
// lectura de la sección "Permisos" (agrupada por módulo en el service) —
// copia de usuarios.repository.js#listPermissionsCatalog, mismo criterio de
// independencia entre módulos que el resto de este archivo.
async function listPermissionsCatalog() {
  return db('permissions')
    .select('id', 'modulo', 'accion', 'codigo', 'descripcion')
    .orderBy(['modulo', 'accion']);
}

// Áreas activas, para las filas en vivo del tab "Agendas" de la matriz de
// permisos — copia de usuarios.repository.js#listAreasActivas.
async function listAreasActivas() {
  return db('areas').where({ activo: true }).orderBy('nombre').select('id', 'nombre', 'slug');
}

// Ids de permisos otorgados a la propia cuenta — para marcar los checks de
// la matriz de solo lectura (ver perfil.service.js#construirMatrizPermisos).
async function listPermisosAsignados(usuarioId) {
  return db('usuario_permisos').where({ usuario_id: usuarioId }).pluck('permission_id');
}

// US-109 AC: valida correo duplicado excluyendo el propio registro — mismo
// criterio (case-insensitive, sin importar el estatus del otro registro)
// que usuarios.repository.js#findByCorreo, aquí solo se compara contra uno
// mismo porque esta pantalla nunca edita a otro usuario.
async function findByCorreo(correo, excludeId) {
  return db('usuarios')
    .whereRaw('lower(correo) = lower(?)', [correo])
    .whereNot('id', excludeId)
    .first('id');
}

// US-109 AC: actualiza ÚNICAMENTE nombre/apellidos/telefono/correo/avatar
// — nunca username, estatus, doctor_id, password_hash ni ninguna otra
// columna, aunque llegara algo más en el objeto de cambios (esta función
// ni siquiera acepta esos parámetros, para que sea imposible colarlos por
// descuido). Registra actualizado_por/actualizado_en con el propio id: es
// el único caso del sistema, junto con auth.repository.js#completarCambioPassword,
// donde actualizado_por es el mismo usuario que se está actualizando.
//
// Extensión: Nombre/Apellidos son datos compartidos entre `usuarios` y
// `doctores` cuando la cuenta tiene un doctor vinculado (pedido explícito
// del usuario: "se almacenan en usuarios y doctores") — si `doctorId`
// viene, dentro de la MISMA transacción también se actualiza el registro
// del doctor (nunca su `activo`, que es un dato que solo se toca desde el
// catálogo de doctores), con su propio actualizado_por/actualizado_en.
// Correo/Teléfono NO se replican: `doctores` no tiene esas columnas.
async function actualizar(id, { nombre, apellidos, telefono, correo, avatar, doctorId }) {
  await db.transaction(async (trx) => {
    await trx('usuarios').where({ id }).update({
      nombre,
      apellidos,
      telefono,
      correo,
      avatar,
      actualizado_por: id,
      actualizado_en: trx.fn.now(),
    });

    if (doctorId) {
      await trx('doctores').where({ id: doctorId }).update({
        nombre,
        apellidos,
        actualizado_por: id,
        actualizado_en: trx.fn.now(),
      });
    }
  });
}

// US-110: para comparar la contraseña actual capturada contra
// usuarios.password_hash vía bcrypt — aparte de findById porque esa función
// nunca expone el hash (no hay razón para traerlo cuando solo se muestran
// datos personales).
async function findPasswordHash(id) {
  return db('usuarios').where({ id }).first('password_hash');
}

// US-110 AC: actualiza ÚNICAMENTE password_hash, con actualizado_por = el
// propio id (mismo criterio que actualizar() de arriba) y actualizado_en.
// Nunca toca ninguna otra columna ni invalida otras sesiones (a diferencia
// de usuarios.repository.js#resetearPassword, que sí lo hace — ahí es un
// ADMINISTRADOR reseteando la cuenta de alguien más por sospecha de
// compromiso; aquí es la propia persona cambiando su contraseña de forma
// voluntaria, su sesión actual debe seguir viva).
async function actualizarPassword(id, passwordHash) {
  await db('usuarios').where({ id }).update({
    password_hash: passwordHash,
    actualizado_por: id,
    actualizado_en: db.fn.now(),
  });
}

module.exports = {
  findById,
  findByCorreo,
  actualizar,
  findDoctorVinculado,
  findAreasDelDoctor,
  listPermissionsCatalog,
  listAreasActivas,
  listPermisosAsignados,
  findPasswordHash,
  actualizarPassword,
};
