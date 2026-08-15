// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias). Mismo
// patrón que doctores.repository.js (tabla estándar del sistema): un LEFT
// JOIN simple a doctores (1 a 1 vía usuarios.doctor_id), sin agregación —
// a diferencia de doctores↔áreas, aquí no hay relación muchos-a-muchos que
// aplanar.
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

// Whitelist fija de expresiones ordenables por columna del header — nunca se
// arma el ORDER BY con el valor de `sort`/`dir` tal cual llega del query
// string (mismo principio que doctores/areas/plantillas_whatsapp.repository.js).
// "nombre" ordena por apellidos+nombre, igual que "doctor" en
// doctores.repository.js — la columna de la tabla muestra el nombre
// completo, no el campo `nombre` a secas.
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

// Independiente de filtros: distingue "el catálogo nunca ha tenido un
// usuario" (imposible en la práctica, siempre hay al menos el admin
// bootstrap de US-000, pero se deja por consistencia con el resto del
// sistema) de "esta búsqueda no encontró nada".
async function existsAny() {
  const row = await db('usuarios').first(db.raw('true as exists')).limit(1);
  return Boolean(row);
}

// US-602: para precargar el formulario de edición.
async function findById(id) {
  return db('usuarios').where({ id }).first();
}

// US-602 AC: "username ya existe en cualquier otro registro, independiente
// de su estatus" — insensible a mayúsculas (evita "Ana.Perez"/"ana.perez"
// como cuentas "distintas"), pero SIN normalizar acentos/espacios como
// areas/plantillas: a diferencia de un nombre de catálogo, un username es
// el mismo valor que login.js compara con `WHERE username = ?` exacto, así
// que lo único que hay que igualar aquí es mayúsculas/minúsculas, no
// acentos (un username no debería tener acentos de todos modos).
async function findByUsername(username, excludeId) {
  return db('usuarios')
    .whereRaw('lower(username) = lower(?)', [username])
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .first();
}

// Mismo criterio que findByUsername, para correo.
async function findByCorreo(correo, excludeId) {
  return db('usuarios')
    .whereRaw('lower(correo) = lower(?)', [correo])
    .modify((builder) => {
      if (excludeId) builder.whereNot('id', excludeId);
    })
    .first();
}

// US-604 (quinta iteración): todos los usernames existentes que coincidan
// con `base` a secas o con `base.N` (N entero) — usado para calcular el
// siguiente consecutivo disponible al proponer un username (ver
// usuarios.service.js#siguienteUsernameDisponible). Insensible a
// mayúsculas, mismo criterio que findByUsername.
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

// US-602 AC: el listbox de "Doctor vinculado" ofrece doctores activos —
// igual que el picker de especialidades de doctores (US-607), un doctor
// dado de baja no debería ofrecerse para una vinculación NUEVA. Si un
// usuario ya editado tenía un doctor que después se dio de baja, su
// vínculo actual se sigue mostrando (ver findDoctorVinculado), solo deja
// de aparecer en ESTA lista para volver a elegirlo desde cero.
async function listDoctoresActivos() {
  return db('doctores')
    .where({ activo: true })
    .orderBy(['apellidos', 'nombre'])
    .select('id', 'nombre', 'apellidos');
}

// Para precargar el combobox en edición con el doctor ya vinculado, sin
// filtrar por activo (a diferencia de listDoctoresActivos) — un vínculo ya
// guardado no debe "desaparecer" del formulario solo porque el doctor se
// dio de baja después.
async function findDoctorVinculado(doctorId) {
  if (!doctorId) return undefined;
  return db('doctores').where({ id: doctorId }).first('id', 'nombre', 'apellidos');
}

// US-604: catálogo completo de permisos posibles, para construir la matriz
// del formulario (agrupada por módulo en el service) — ordenado por módulo
// y acción para que la agrupación sea determinista.
async function listPermissionsCatalog() {
  return db('permissions')
    .select('id', 'modulo', 'accion', 'codigo', 'descripcion')
    .orderBy(['modulo', 'accion']);
}

// US-604: ids de permisos YA asignados a un usuario — para marcar los
// checkboxes correspondientes al precargar el formulario de edición.
async function listPermisosUsuario(usuarioId) {
  return db('usuario_permisos').where({ usuario_id: usuarioId }).pluck('permission_id');
}

// US-604 AC: "no permite retirar usuarios.permisos al último usuario activo
// que conserva la capacidad" — cuenta usuarios ACTIVOS (excluyendo el que se
// está editando) que ya tienen ese permiso, sin importar cuántos otros
// permisos tengan.
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

// US-604: resuelve el id del permiso "usuarios.permisos" — se busca por
// código en vez de asumir un id fijo, porque el catálogo se siembra desde
// 01_permissions.js y sus ids autoincrementales pueden variar entre
// entornos.
async function findPermissionIdByCodigo(codigo) {
  const row = await db('permissions').where({ codigo }).first('id');
  return row ? row.id : null;
}

// US-604 (cuarta iteración): áreas activas para las filas en vivo del tab
// "Agendas" de la matriz de permisos — mismo criterio que
// listDoctoresActivos (solo activas se ofrecen). Vive aquí (no en
// areas.repository.js) porque usuarios.html es quien la consume.
async function listAreasActivas() {
  return db('areas').where({ activo: true }).orderBy('nombre').select('id', 'nombre', 'slug');
}

// US-603: baja lógica — nunca DELETE físico, se conserva el registro y sus
// relaciones históricas (creado_por/actualizado_por en otras tablas siguen
// apuntando a este id sin tocarse). El `whereNot('estatus', 'inactivo')` en
// la MISMA query (no un SELECT previo + UPDATE) hace que la operación sea
// atómica e idempotente de una sola vez: si el usuario ya estaba inactivo,
// `affected` da 0 y ni se pisan `desactivado_por`/`desactivado_en` ya
// existentes ni se borra ninguna sesión (AC: "no vuelve a ejecutar la
// operación ni modifica los valores existentes").
//
// Además invalida cualquier sesión activa de ese usuario: las sesiones viven
// en la tabla `session` (connect-pg-simple, ver config/session.js), cada fila
// con el usuario logueado serializado en `sess.user`. Se borra la fila
// completa (no solo se limpia `sess.user`) — la próxima petición protegida
// de ese navegador ya no encuentra una sesión válida y cae al mismo
// comportamiento genérico que ya existe hoy para sesión expirada
// (requireAuth.js), sin agregar ninguna consulta nueva a las demás rutas de
// la app.
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

// US-602 AC: alta — estatus='activo', intentos_fallidos=0, bloqueado_en=null
// siempre (nunca los manda el formulario), password_hash ya viene
// calculado por el service (bcrypt.hash, nunca texto plano en esta capa).
// US-604: crea también las filas de usuario_permisos por cada permiso
// seleccionado, en la MISMA transacción que el insert del usuario — si el
// insert de usuario_permisos fallara (p.ej. un id de permiso que ya no
// existe), el usuario tampoco debe quedar creado a medias (AC: "no debe
// dejar registros parciales de permisos").
async function create({
  nombre,
  apellidos,
  correo,
  telefono,
  username,
  passwordHash,
  doctorId,
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

// US-602 AC: edición — nunca toca password_hash (el cambio de contraseña
// es una historia aparte). El estatus se puede editar aquí mismo (a
// diferencia de doctores/plantillas, donde el estado activo/inactivo es
// una sola transición booleana): dentro de una transacción se lee el
// estatus ANTERIOR para decidir dos cosas de forma independiente —
// 1) si el nuevo estatus es 'activo' y el anterior no lo era, resetea
//    intentos_fallidos/bloqueado_en (AC explícito para bloqueado,
//    bloqueo_temp e inactivo -> activo: las tres transiciones piden
//    exactamente este mismo reset, sea cual sea el estatus de origen).
// 2) si el estatus entra o sale de 'inactivo', fija/limpia
//    desactivado_por/desactivado_en — mismo criterio de trazabilidad que
//    doctores/areas/plantillas_whatsapp, generalizado aquí a un campo
//    `estatus` con 4 valores en vez de un booleano `activo`.
// US-604: `permissionIds` es `undefined` cuando quien edita NO tiene
// usuarios.permisos (el apartado de Permisos ni siquiera se mostró en el
// formulario) — en ese caso NO se toca usuario_permisos en absoluto, para
// no borrar accidentalmente los permisos ya asignados por el simple hecho
// de que este editor no los ve. Cuando SÍ viene un array (aunque esté
// vacío), se diffea contra lo ya asignado: se insertan los nuevos con
// otorgado_por/otorgado_en frescos, se borran los que se desmarcaron, y los
// que se quedan marcados NO se tocan (AC: "no crea registros duplicados ni
// modifica innecesariamente otorgado_por u otorgado_en").
async function update(
  id,
  { nombre, apellidos, correo, telefono, username, doctorId, estatus, permissionIds, usuarioId },
) {
  await db.transaction(async (trx) => {
    const actual = await trx('usuarios').where({ id }).first('estatus');

    const cambios = {
      nombre,
      apellidos,
      correo,
      telefono,
      username,
      doctor_id: doctorId,
      estatus,
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
  findDoctorVinculado,
  listPermissionsCatalog,
  listPermisosUsuario,
  countUsuariosActivosConPermiso,
  findPermissionIdByCodigo,
  listAreasActivas,
  create,
  update,
  darDeBaja,
};
