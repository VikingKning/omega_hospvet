const db = require('../../config/database');

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

async function listPermissionsCatalog() {
  return db('permissions')
    .select('id', 'modulo', 'accion', 'codigo', 'descripcion')
    .orderBy(['modulo', 'accion']);
}

async function listAreasActivas() {
  return db('areas').where({ activo: true }).orderBy('nombre').select('id', 'nombre', 'slug');
}

async function listPermisosAsignados(usuarioId) {
  return db('usuario_permisos').where({ usuario_id: usuarioId }).pluck('permission_id');
}

async function findByCorreo(correo, excludeId) {
  return db('usuarios')
    .whereRaw('lower(correo) = lower(?)', [correo])
    .whereNot('id', excludeId)
    .first('id');
}

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

async function findPasswordHash(id) {
  return db('usuarios').where({ id }).first('password_hash');
}

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
