const bcrypt = require('bcrypt');
const crypto = require('crypto');
const repository = require('./usuarios.repository');
const { assertPasswordValida } = require('../../config/passwordPolicy');

class UsuarioValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class DuplicateUsernameError extends Error {
  constructor(sugerido) {
    super(
      sugerido
        ? `Ese nombre de usuario ya no está disponible. Se ha actualizado a "${sugerido}".`
        : 'El nombre de usuario ya está registrado.',
    );
    this.status = 409;
    this.usernameSugerido = sugerido ?? null;
  }
}

class DuplicateCorreoError extends Error {
  constructor() {
    super('El correo ya está registrado.');
    this.status = 409;
  }
}

class UltimoAdministradorPermisosError extends Error {
  constructor() {
    super('Debe existir al menos un usuario activo con capacidad para administrar permisos.');
    this.status = 409;
  }
}

class NoPuedeDarDeBajaPropiaCuentaError extends Error {
  constructor() {
    super('Un usuario no puede dar de baja su propia cuenta.');
    this.status = 400;
  }
}

class NoPuedeResetearPropiaCuentaError extends Error {
  constructor() {
    super('Un usuario no puede restablecer la contraseña de su propia cuenta.');
    this.status = 400;
  }
}

class DoctorYaVinculadoError extends Error {
  constructor() {
    super('Ese doctor ya tiene una cuenta de usuario vinculada.');
    this.status = 409;
  }
}

const BCRYPT_COST = 12;

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['nombre', 'username', 'correo', 'estatus'];

const ESTATUS_VALUES_EDITABLES = ['activo', 'bloqueo_temp', 'bloqueado', 'inactivo'];

const TIPOS_USUARIO = ['doctor', 'estilista', 'recepcion', 'usuario'];

const ESTATUS_VALUES_FILTRO = [...ESTATUS_VALUES_EDITABLES, 'cambio_pwd'];

function parsePage(rawPage) {
  const page = Number.parseInt(rawPage, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSort(rawSort) {
  return SORT_COLUMNS.includes(rawSort) ? rawSort : 'nombre';
}

function parseDir(rawDir) {
  return rawDir === 'desc' ? 'desc' : 'asc';
}

function parseEstatus(rawEstatus) {
  if (ESTATUS_VALUES_FILTRO.includes(rawEstatus)) return rawEstatus;
  if (rawEstatus === 'todos') return 'todos';
  return 'activo';
}

async function list({ q, estatus: rawEstatus, page: rawPage, sort: rawSort, dir: rawDir }) {
  const trimmedQ = (q ?? '').trim();
  const estatus = parseEstatus(rawEstatus);
  const filtroEstatus = estatus === 'todos' ? undefined : estatus;
  const page = parsePage(rawPage);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = { q: trimmedQ || undefined, estatus: filtroEstatus };

  const [usuarios, total, catalogoVacio] = await Promise.all([
    repository.findPage({ ...filters, sort, dir, limit: PAGE_SIZE, offset }),
    repository.count(filters),
    repository.existsAny().then((exists) => !exists),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    usuarios,
    total,
    catalogoVacio,
    page: Math.min(page, totalPages),
    totalPages,
    pageSize: PAGE_SIZE,
    q: trimmedQ,
    estatus,
    sort,
    dir,
  };
}

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const usuario = await repository.findById(id);
  if (!usuario) return undefined;
  const doctor = await repository.findDoctorVinculado(usuario.doctor_id);
  return { ...usuario, telefono: formatTelefono(usuario.telefono), doctor };
}

async function listDoctoresDisponibles() {
  return repository.listDoctoresActivos();
}

async function resolverDoctor(rawDoctorId) {
  const doctorId = parseDoctorId(rawDoctorId);
  if (doctorId === null) return null;
  return (await repository.findDoctorVinculado(doctorId)) ?? null;
}

const DIACRITIC_MARKS = /[̀-ͯ]/g;

function normalizarParaUsername(palabra) {
  return palabra
    .normalize('NFD')
    .replace(DIACRITIC_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function primeraPalabra(texto) {
  return (texto ?? '').trim().split(/\s+/)[0] ?? '';
}

async function siguienteUsernameDisponible(prefijo, excludeId) {
  const existentes = await repository.findUsernamesConPrefijo(prefijo, excludeId);
  const existentesLower = new Set(existentes.map((u) => u.toLowerCase()));
  if (!existentesLower.has(prefijo.toLowerCase())) return prefijo;

  const prefijoEscapado = prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patron = new RegExp(`^${prefijoEscapado}\\.(\\d+)$`, 'i');
  const sufijos = existentes
    .map((u) => u.match(patron))
    .filter(Boolean)
    .map((m) => Number.parseInt(m[1], 10));
  const siguiente = sufijos.length ? Math.max(...sufijos) + 1 : 2;
  return `${prefijo}.${siguiente}`;
}

async function sugerirUsername(rawNombre, rawApellidos, rawExcludeId) {
  const nombre = normalizarParaUsername(primeraPalabra(rawNombre));
  const apellido = normalizarParaUsername(primeraPalabra(rawApellidos));
  if (!nombre || !apellido) return '';

  const excludeId = parseId(rawExcludeId);
  return siguienteUsernameDisponible(`${nombre}.${apellido}`, excludeId ?? undefined);
}

function validateTexto(rawValor, etiqueta, maxLength) {
  const valor = (rawValor ?? '').trim();
  if (!valor) {
    throw new UsuarioValidationError(`El campo ${etiqueta} es obligatorio.`);
  }
  if (maxLength && valor.length > maxLength) {
    throw new UsuarioValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCorreo(rawCorreo) {
  const correo = validateTexto(rawCorreo, 'Correo', 150);
  if (!CORREO_REGEX.test(correo)) {
    throw new UsuarioValidationError('El correo no tiene un formato válido.');
  }
  return correo;
}

function stripTelefono(telefono) {
  return (telefono ?? '').replace(/\D/g, '');
}

function formatTelefono(telefono) {
  const digits = stripTelefono(telefono);
  if (digits.length !== 10) return telefono;
  const prefijo = digits.slice(0, 2);
  if (prefijo === '55' || prefijo === '56') {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function parseTelefono(rawTelefono) {
  const telefono = stripTelefono(rawTelefono);
  return telefono || null;
}

function parseDoctorId(rawDoctorId) {
  if (rawDoctorId === undefined || rawDoctorId === null || rawDoctorId === '') return null;
  const id = Number.parseInt(rawDoctorId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseTipoUsuario(rawTipoUsuario, doctorId) {
  if (doctorId) return 'doctor';
  return TIPOS_USUARIO.includes(rawTipoUsuario) ? rawTipoUsuario : 'usuario';
}

function parseBooleanCheckbox(rawValor) {
  return rawValor === true || rawValor === 'true' || rawValor === 'on' || rawValor === '1';
}

function parseEstatusEdicion(rawEstatus) {
  return ESTATUS_VALUES_EDITABLES.includes(rawEstatus) ? rawEstatus : 'activo';
}

function parsePermissionIds(rawPermisos) {
  const valores = rawPermisos === undefined ? [] : [].concat(rawPermisos);
  const ids = valores
    .flatMap((valor) => String(valor).split(','))
    .map((valor) => Number.parseInt(valor, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

const ORDEN_ACCIONES_PRIORITARIAS = ['ver', 'crear', 'editar', 'eliminar'];

function ordenarAcciones(acciones) {
  const prioritarias = ORDEN_ACCIONES_PRIORITARIAS.filter((accion) => acciones.includes(accion));
  const resto = acciones.filter((accion) => !ORDEN_ACCIONES_PRIORITARIAS.includes(accion)).sort();
  return [...prioritarias, ...resto];
}

const ACCIONES_SIN_CHECKBOX_PROPIO = ['permisos', 'resetear_password'];

function combinarCargaEnvio(permisosPorAccion) {
  const cargar = permisosPorAccion.get('cargar');
  const enviar = permisosPorAccion.get('enviar');
  if (!cargar || !enviar) return permisosPorAccion;

  const combinado = new Map(permisosPorAccion);
  combinado.delete('cargar');
  combinado.delete('enviar');
  combinado.set('carga_envio', {
    id: `${cargar.id},${enviar.id}`,
    modulo: cargar.modulo,
    accion: 'carga_envio',
    codigo: null,
    descripcion: 'Cargar y enviar archivos de resultados de laboratorio',
  });
  return combinado;
}

const TAB_MENU_PRINCIPAL = {
  id: 'principal',
  titulo: 'Menú Principal',
  secciones: [
    { titulo: null, modulos: ['tutores'] },
    { titulo: null, modulos: ['laboratorio'] },
    {
      titulo: 'Métricas',
      modulos: ['metricas_whatsapp', 'metricas_laboratorio', 'metricas_agenda'],
    },
  ],
};

const TAB_CONFIGURACIONES = {
  id: 'configuraciones',
  titulo: 'Configuraciones',
  secciones: [
    { titulo: null, modulos: ['usuarios', 'doctores', 'areas', 'plantillas', 'configuracion'] },
  ],
};

function construirTab(id, titulo, secciones, porModulo) {
  const accionesSet = new Set();
  const seccionesConFilas = secciones
    .map(({ titulo: seccionTitulo, modulos: nombresModulo }) => {
      const nombresPresentes = nombresModulo.filter((nombre) => porModulo.has(nombre));
      nombresPresentes.forEach((nombre) => {
        porModulo.get(nombre).forEach((_, accion) => accionesSet.add(accion));
      });
      return { titulo: seccionTitulo, nombresModulo: nombresPresentes };
    })
    .filter((seccion) => seccion.nombresModulo.length);

  if (!seccionesConFilas.length) return null;

  const acciones = ordenarAcciones([...accionesSet]);
  const secciones2 = seccionesConFilas.map(({ titulo: seccionTitulo, nombresModulo }) => ({
    titulo: seccionTitulo,
    modulos: nombresModulo.map((modulo) => ({
      modulo,
      celdas: acciones.map((accion) => porModulo.get(modulo).get(accion) ?? null),
    })),
  }));

  return { id, titulo, acciones, secciones: secciones2 };
}

function construirTabAgendas(areasActivas, porModulo) {
  const filas = areasActivas
    .map((area) => {
      const permisosPorAccion = porModulo.get(`agenda_${area.slug}`);
      return permisosPorAccion ? { area, permisosPorAccion } : null;
    })
    .filter(Boolean);

  if (!filas.length) return null;

  const accionesSet = new Set();
  filas.forEach(({ permisosPorAccion }) => {
    permisosPorAccion.forEach((_, accion) => accionesSet.add(accion));
  });

  const acciones = ordenarAcciones([...accionesSet]);
  const modulos = filas.map(({ area, permisosPorAccion }) => ({
    modulo: `agenda_${area.slug}`,
    nombre: area.nombre,
    celdas: acciones.map((accion) => permisosPorAccion.get(accion) ?? null),
  }));

  return { id: 'agendas', titulo: 'Agendas', acciones, secciones: [{ titulo: null, modulos }] };
}

function construirMatrizPermisos(catalogo, areasActivas = []) {
  const catalogoVisible = catalogo.filter(
    (permiso) => !ACCIONES_SIN_CHECKBOX_PROPIO.includes(permiso.accion),
  );

  const porModulo = new Map();
  for (const permiso of catalogoVisible) {
    if (!porModulo.has(permiso.modulo)) porModulo.set(permiso.modulo, new Map());
    porModulo.get(permiso.modulo).set(permiso.accion, permiso);
  }
  for (const [modulo, permisosPorAccion] of porModulo) {
    porModulo.set(modulo, combinarCargaEnvio(permisosPorAccion));
  }

  const tabPrincipal = construirTab(
    TAB_MENU_PRINCIPAL.id,
    TAB_MENU_PRINCIPAL.titulo,
    TAB_MENU_PRINCIPAL.secciones,
    porModulo,
  );
  const tabAgendas = construirTabAgendas(areasActivas, porModulo);
  const tabConfiguraciones = construirTab(
    TAB_CONFIGURACIONES.id,
    TAB_CONFIGURACIONES.titulo,
    TAB_CONFIGURACIONES.secciones,
    porModulo,
  );

  return { tabs: [tabPrincipal, tabAgendas, tabConfiguraciones].filter(Boolean) };
}

async function obtenerCatalogoPermisos() {
  return repository.listPermissionsCatalog();
}

async function listAreasParaPermisos() {
  return repository.listAreasActivas();
}

async function permisosAsignadosDe(usuarioId) {
  if (!usuarioId) return [];
  return repository.listPermisosUsuario(usuarioId);
}

const CODIGO_PERMISO_ADMINISTRAR_PERMISOS = 'usuarios.permisos';

async function validarNoDejarSinAdministradores(usuarioId, permissionIdsSeleccionados) {
  const permisoAdminId = await repository.findPermissionIdByCodigo(
    CODIGO_PERMISO_ADMINISTRAR_PERMISOS,
  );
  if (!permisoAdminId) return; // catálogo sin ese código: nada que proteger

  const actuales = await repository.listPermisosUsuario(usuarioId);
  const teniaAdmin = actuales.includes(permisoAdminId);
  const conservaAdmin = permissionIdsSeleccionados.includes(permisoAdminId);
  if (!teniaAdmin || conservaAdmin) return;

  const otros = await repository.countUsuariosActivosConPermiso(permisoAdminId, usuarioId);
  if (otros === 0) {
    throw new UltimoAdministradorPermisosError();
  }
}

async function aplicarReglaEditarUsuariosIncluyePermisos(permissionIds) {
  const editarId = await repository.findPermissionIdByCodigo('usuarios.editar');
  if (!editarId || !permissionIds.includes(editarId)) return permissionIds;

  const [permisosId, resetId] = await Promise.all([
    repository.findPermissionIdByCodigo('usuarios.permisos'),
    repository.findPermissionIdByCodigo('usuarios.resetear_password'),
  ]);
  const faltantes = [permisosId, resetId].filter((id) => id && !permissionIds.includes(id));
  return faltantes.length ? [...permissionIds, ...faltantes] : permissionIds;
}

async function aplicarReglaVerImplicaAcciones(permissionIds) {
  const catalogo = await repository.listPermissionsCatalog();
  const porModulo = new Map();
  for (const permiso of catalogo) {
    if (!porModulo.has(permiso.modulo)) porModulo.set(permiso.modulo, new Map());
    porModulo.get(permiso.modulo).set(permiso.accion, permiso.id);
  }

  const seleccionados = new Set(permissionIds);
  const faltantes = [];
  for (const accionesPorId of porModulo.values()) {
    const verId = accionesPorId.get('ver');
    if (!verId || seleccionados.has(verId)) continue;

    const otrosIds = [...accionesPorId.entries()]
      .filter(([accion]) => accion !== 'ver')
      .map(([, id]) => id);
    if (otrosIds.some((id) => seleccionados.has(id))) {
      faltantes.push(verId);
    }
  }

  return faltantes.length ? [...permissionIds, ...faltantes] : permissionIds;
}

async function crear({
  nombre: rawNombre,
  apellidos: rawApellidos,
  correo: rawCorreo,
  telefono: rawTelefono,
  username: rawUsername,
  password: rawPassword,
  doctorId: rawDoctorId,
  tipoUsuario: rawTipoUsuario,
  notificacionesAlertas: rawNotificacionesAlertas,
  permisos: rawPermisos,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre', 100);
  const apellidos = validateTexto(rawApellidos, 'Apellidos', 100);
  const correo = validateCorreo(rawCorreo);
  const username = validateTexto(rawUsername, 'Username', 50);
  const telefono = parseTelefono(rawTelefono);

  const password = rawPassword ?? '';
  try {
    await assertPasswordValida(password);
  } catch (err) {
    throw new UsuarioValidationError(err.message);
  }

  if (await repository.findByUsername(username)) {
    throw new DuplicateUsernameError(await siguienteUsernameDisponible(username));
  }
  if (await repository.findByCorreo(correo)) {
    throw new DuplicateCorreoError();
  }

  const doctorId = parseDoctorId(rawDoctorId);
  if (doctorId && (await repository.findByDoctorId(doctorId))) {
    throw new DoctorYaVinculadoError();
  }

  const tipoUsuario = parseTipoUsuario(rawTipoUsuario, doctorId);
  const notificacionesAlertas = parseBooleanCheckbox(rawNotificacionesAlertas);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const permissionIds = await aplicarReglaEditarUsuariosIncluyePermisos(
    await aplicarReglaVerImplicaAcciones(parsePermissionIds(rawPermisos)),
  );

  return repository.create({
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
  });
}

async function editar({
  id,
  nombre: rawNombre,
  apellidos: rawApellidos,
  correo: rawCorreo,
  telefono: rawTelefono,
  username: rawUsername,
  estatus: rawEstatus,
  tipoUsuario: rawTipoUsuario,
  notificacionesAlertas: rawNotificacionesAlertas,
  permisos: rawPermisos,
  permisosProvistos,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre', 100);
  const apellidos = validateTexto(rawApellidos, 'Apellidos', 100);
  const correo = validateCorreo(rawCorreo);
  const username = validateTexto(rawUsername, 'Username', 50);
  const telefono = parseTelefono(rawTelefono);
  const estatus = parseEstatusEdicion(rawEstatus);
  const tipoUsuario = parseTipoUsuario(rawTipoUsuario, null);
  const notificacionesAlertas = parseBooleanCheckbox(rawNotificacionesAlertas);

  if (await repository.findByUsername(username, id)) {
    throw new DuplicateUsernameError(await siguienteUsernameDisponible(username, id));
  }
  if (await repository.findByCorreo(correo, id)) {
    throw new DuplicateCorreoError();
  }

  let permissionIds;
  if (permisosProvistos) {
    permissionIds = await aplicarReglaEditarUsuariosIncluyePermisos(
      await aplicarReglaVerImplicaAcciones(parsePermissionIds(rawPermisos)),
    );
    await validarNoDejarSinAdministradores(id, permissionIds);
  }

  await repository.update(id, {
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
  });
}

async function darDeBaja(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  if (id === usuarioId) {
    throw new NoPuedeDarDeBajaPropiaCuentaError();
  }
  await repository.darDeBaja(id, usuarioId);
}

const TEMP_PASSWORD_LENGTH = 16;
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generarPasswordTemporal() {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    password += TEMP_PASSWORD_ALPHABET[crypto.randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}

async function resetearPassword(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return null;
  if (id === usuarioId) {
    throw new NoPuedeResetearPropiaCuentaError();
  }

  const passwordTemporal = generarPasswordTemporal();
  const passwordHash = await bcrypt.hash(passwordTemporal, BCRYPT_COST);
  const afectado = await repository.resetearPassword(id, passwordHash, usuarioId);
  return afectado ? passwordTemporal : null;
}

module.exports = {
  list,
  obtener,
  listDoctoresDisponibles,
  resolverDoctor,
  sugerirUsername,
  obtenerCatalogoPermisos,
  permisosAsignadosDe,
  listAreasParaPermisos,
  construirMatrizPermisos,
  parsePermissionIds,
  parseTipoUsuario,
  parseBooleanCheckbox,
  crear,
  editar,
  darDeBaja,
  resetearPassword,
  UsuarioValidationError,
  DuplicateUsernameError,
  DuplicateCorreoError,
  UltimoAdministradorPermisosError,
  NoPuedeDarDeBajaPropiaCuentaError,
  NoPuedeResetearPropiaCuentaError,
  DoctorYaVinculadoError,
};
