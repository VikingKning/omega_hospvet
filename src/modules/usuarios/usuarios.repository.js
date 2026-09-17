const db = require('../../config/database');

function baseQuery({ q, estatus }) {
  return db('usuarios as u').modify((builder) => {
    if (estatus) builder.where('u.estatus', estatus);
    if (q) {
      builder.where((b) => {
        b.whereRaw('u.nombre ILIKE ?', [`%${q}%`])
          .orWhereRaw('u.apellidos ILIKE ?', [`%${q}%`])
          .orWhereRaw('u.username ILIKE ?', [`%${q}%`])
          .orWhereRaw('u.correo ILIKE ?', [`%${q}%`]);
      });
    }
  });
}

async function count({ q, estatus }) {
  const row = await baseQuery({ q, estatus }).count('u.id as total').first();
  return Number(row.total);
}

const SORT_EXPRESSIONS = {
  nombre: (dir) => `u.apellidos ${dir}, u.nombre ${dir}`,
  username: (dir) => `u.username ${dir}`,
  correo: (dir) => `u.correo ${dir}`,
  estatus: (dir) => `u.estatus ${dir}`,
};

function applySort(query, { sort, dir }) {
  const direction = dir === 'desc' ? 'desc' : 'asc';
  const buildExpression = SORT_EXPRESSIONS[sort] ?? SORT_EXPRESSIONS.nombre;
  return query.orderByRaw(buildExpression(direction));
}

async function findPage({ q, estatus, sort, dir, limit, offset }) {
  return applySort(baseQuery({ q, estatus }).leftJoin('doctores as d', 'd.id', 'u.doctor_id'), {
    sort,
    dir,
  })
    .limit(limit)
    .offset(offset)
    .select(
      'u.id',
      'u.nombre',
      'u.apellidos',
      'u.username',
      'u.correo',
      'u.estatus',
      'd.nombre as doctor_nombre',
      'd.apellidos as doctor_apellidos',
    );
}

async function existsAny() {
  const row = await db('usuarios').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

async function findById(id) {
  return db('usuarios').where({ id }).first();
}

async function findByUsername(username, excludeId) {
  return db('usuarios')
    .whereRaw('lower(username) = lower(?)', [username])
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .first();
}

async function findByCorreo(correo, excludeId) {
  return db('usuarios')
    .whereRaw('lower(correo) = lower(?)', [correo])
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .first();
}

async function findUsernamesConPrefijo(base, excludeId) {
  return db('usuarios')
    .where((builder) => {
      builder
        .whereRaw('lower(username) = lower(?)', [base])
        .orWhereRaw('lower(username) like lower(?)', [`${base}.%`]);
    })
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .pluck('username');
}

async function listDoctoresActivos() {
  return db('doctores as d')
    .where('d.activo', true)
    .whereNotExists(function excluirYaVinculados() {
      this.select(1).from('usuarios as u').whereRaw('u.doctor_id = d.id');
    })
    .orderBy(['d.apellidos', 'd.nombre'])
    .select('d.id', 'd.nombre', 'd.apellidos');
}

async function findByDoctorId(doctorId) {
  return db('usuarios').where({ doctor_id: doctorId }).first();
}

async function findDoctorVinculado(doctorId) {
  if (!doctorId) return undefined;
  return db('doctores').where({ id: doctorId }).first('id', 'nombre', 'apellidos');
}

async function listPermissionsCatalog() {
  return db('permissions')
    .select('id', 'modulo', 'accion', 'codigo', 'descripcion')
    .orderBy(['modulo', 'accion']);
}

async function listPermisosUsuario(usuarioId) {
  return db('usuario_permisos').where({ usuario_id: usuarioId }).pluck('permission_id');
}

async function countUsuariosActivosConPermiso(permissionId, excludeUsuarioId) {
  const row = await db('usuario_permisos as up')
    .join('usuarios as u', 'u.id', 'up.usuario_id')
    .where('up.permission_id', permissionId)
    .where('u.estatus', 'activo')
    .whereNot('u.id', excludeUsuarioId)
    .countDistinct('u.id as total')
    .first();
  return Number(row.total);
}

async function findPermissionIdByCodigo(codigo) {
  const row = await db('permissions').where({ codigo }).first('id');
  return row ? row.id : null;
}

async function listAreasActivas() {
  return db('areas').where({ activo: true }).orderBy('nombre').select('id', 'nombre', 'slug');
}

async function darDeBaja(id, usuarioId) {
  await db.transaction(async (trx) => {
    const affected = await trx('usuarios').where({ id }).whereNot('estatus', 'inactivo').update({
      estatus: 'inactivo',
      desactivado_por: usuarioId,
      desactivado_en: trx.fn.now(),
    });

    if (affected) {
      await trx('session').whereRaw("(sess->'user'->>'id')::int = ?", [id]).del();
    }
  });
}

async function resetearPassword(id, passwordHash, usuarioId) {
  return db.transaction(async (trx) => {
    const actual = await trx('usuarios').where({ id }).first('estatus');
    if (!actual) return 0;

    const nuevoEstatus = actual.estatus === 'inactivo' ? 'inactivo' : 'cambio_pwd';

    const affected = await trx('usuarios').where({ id }).update({
      password_hash: passwordHash,
      estatus: nuevoEstatus,
      intentos_fallidos: 0,
      bloqueado_en: null,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    });

    if (affected) {
      await trx('session').whereRaw("(sess->'user'->>'id')::int = ?", [id]).del();
    }

    return affected;
  });
}

async function create({
  nombre,
  apellidos,
  correo,
  telefono,
  username,
  passwordHash,
  doctorId,
  tipoUsuario,
  notificacionesAlertas,
  permissionIds,
  usuarioId,
}) {
  return db.transaction(async (trx) => {
    const [row] = await trx('usuarios')
      .insert({
        nombre,
        apellidos,
        correo,
        telefono,
        username,
        password_hash: passwordHash,
        doctor_id: doctorId,
        tipo_usuario: doctorId ? 'doctor' : tipoUsuario,
        notificaciones_alertas: notificacionesAlertas,
        estatus: 'activo',
        intentos_fallidos: 0,
        bloqueado_en: null,
        creado_por: usuarioId,
        creado_en: trx.fn.now(),
      })
      .returning('id');

    if (permissionIds.length) {
      await trx('usuario_permisos').insert(
        permissionIds.map((permissionId) => ({
          usuario_id: row.id,
          permission_id: permissionId,
          otorgado_por: usuarioId,
          otorgado_en: trx.fn.now(),
        })),
      );
    }

    return row.id;
  });
}

async function update(
  id,
  {
    nombre,
    apellidos,
    correo,
    telefono,
    username,
    estatus,
    tipoUsuario,
    notificacionesAlertas,
    permissionIds,
    usuarioId,
  },
) {
  await db.transaction(async (trx) => {
    const actual = await trx('usuarios')
      .where({ id })
      .first('estatus', 'doctor_id', 'tipo_usuario');

    const tipoUsuarioFinal =
      actual.tipo_usuario === 'admin' ? 'admin' : actual.doctor_id ? 'doctor' : tipoUsuario;

    const cambios = {
      nombre,
      apellidos,
      correo,
      telefono,
      username,
      estatus,
      tipo_usuario: tipoUsuarioFinal,
      notificaciones_alertas: notificacionesAlertas,
      actualizado_por: usuarioId,
      actualizado_en: trx.fn.now(),
    };

    if (estatus === 'activo' && actual.estatus !== 'activo') {
      cambios.intentos_fallidos = 0;
      cambios.bloqueado_en = null;
    }

    if (estatus === 'inactivo' && actual.estatus !== 'inactivo') {
      cambios.desactivado_por = usuarioId;
      cambios.desactivado_en = trx.fn.now();
    } else if (estatus !== 'inactivo' && actual.estatus === 'inactivo') {
      cambios.desactivado_por = null;
      cambios.desactivado_en = null;
    }

    await trx('usuarios').where({ id }).update(cambios);

    if (permissionIds !== undefined) {
      const actuales = await trx('usuario_permisos')
        .where({ usuario_id: id })
        .pluck('permission_id');
      const actualesSet = new Set(actuales);
      const seleccionadosSet = new Set(permissionIds);

      const aAgregar = permissionIds.filter((permissionId) => !actualesSet.has(permissionId));
      const aQuitar = actuales.filter((permissionId) => !seleccionadosSet.has(permissionId));

      if (aAgregar.length) {
        await trx('usuario_permisos').insert(
          aAgregar.map((permissionId) => ({
            usuario_id: id,
            permission_id: permissionId,
            otorgado_por: usuarioId,
            otorgado_en: trx.fn.now(),
          })),
        );
      }
      if (aQuitar.length) {
        await trx('usuario_permisos')
          .where({ usuario_id: id })
          .whereIn('permission_id', aQuitar)
          .del();
      }
    }
  });
}

module.exports = {
  count,
  findPage,
  existsAny,
  findById,
  findByUsername,
  findByCorreo,
  findUsernamesConPrefijo,
  listDoctoresActivos,
  findByDoctorId,
  findDoctorVinculado,
  listPermissionsCatalog,
  listPermisosUsuario,
  countUsuariosActivosConPermiso,
  findPermissionIdByCodigo,
  listAreasActivas,
  create,
  update,
  darDeBaja,
  resetearPassword,
};
