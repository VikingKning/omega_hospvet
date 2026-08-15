const bcrypt = require('bcrypt');
const repository = require('./usuarios.repository');

// Mismo patrón de errores con `.status` que areas/plantillas_whatsapp.service.js
// — el controller los atrapa para re-renderizar el formulario con el
// mensaje, en vez de un 400/409 JSON crudo (esto es un fragmento HTMX, no
// una API).
class UsuarioValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// US-604 (quinta iteración) AC: "si entre la generación de la propuesta y
// el guardado otro usuario tomó ese mismo username, el sistema deberá
// calcular un nuevo consecutivo y avisar al administrador". `sugerido`
// (opcional) es ese consecutivo ya recalculado — el controller lo usa para
// volver a mostrar el formulario con el username sugerido YA precargado en
// vez del que chocó, en vez de dejar al administrador a que lo piense de
// nuevo a mano.
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

// US-604 AC: "no permite retirar usuarios.permisos al último usuario activo
// que conserva la capacidad para administrar permisos".
class UltimoAdministradorPermisosError extends Error {
  constructor() {
    super('Debe existir al menos un usuario activo con capacidad para administrar permisos.');
    this.status = 409;
  }
}

// US-603 AC: "un usuario no puede dar de baja su propia cuenta".
class NoPuedeDarDeBajaPropiaCuentaError extends Error {
  constructor() {
    super('Un usuario no puede dar de baja su propia cuenta.');
    this.status = 400;
  }
}

// US-602 (octava iteración) AC: "para no duplicar doctores con cuenta" — un
// doctor no puede quedar vinculado a más de un usuario. Solo aplica en
// alta: en edición el vínculo ya no se puede tocar (ver editar() más
// abajo), así que ahí no hace falta ni puede dispararse este error.
class DoctorYaVinculadoError extends Error {
  constructor() {
    super('Ese doctor ya tiene una cuenta de usuario vinculada.');
    this.status = 409;
  }
}

// Mismo costo que 05_admin_usuario.js/auth.service.js#DUMMY_HASH — un solo
// costo de bcrypt para toda cuenta real del sistema, sea sembrada o creada
// desde este formulario.
const BCRYPT_COST = 12;
const PASSWORD_MIN_LENGTH = 8;

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['nombre', 'username', 'correo', 'estatus'];
const ESTATUS_VALUES = ['activo', 'bloqueo_temp', 'bloqueado', 'inactivo'];

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

// Filtro de Estatus: a diferencia del switch Activos/Todos de
// doctores/áreas (booleano), aquí hay 5 opciones reales (Todos + los 4
// valores de usuarios.estatus del bloqueo escalonado de US-106). Por
// defecto es "activo" (decidido explícitamente con el usuario — a
// diferencia de plantillas, que por AC explícito default a "todos"; aquí
// el AC no lo especificaba, así que se preguntó y "activo" quedó como el
// criterio consistente con doctores/áreas). Cualquier valor que no sea uno
// de los 4 estatus válidos ni "todos" cae al default, nunca truena.
function parseEstatus(rawEstatus) {
  if (ESTATUS_VALUES.includes(rawEstatus)) return rawEstatus;
  if (rawEstatus === 'todos') return 'todos';
  return 'activo';
}

// Query params de un listado GET: se sanean con valores por defecto en vez
// de rechazarse con un error (mismo criterio que el resto de los catálogos
// de Configuraciones).
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

// US-602: para precargar el formulario de edición — incluye el doctor
// vinculado (id + nombre) para pintar el combobox ya seleccionado.
async function obtener(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const usuario = await repository.findById(id);
  if (!usuario) return undefined;
  const doctor = await repository.findDoctorVinculado(usuario.doctor_id);
  return { ...usuario, doctor };
}

// Catálogo de doctores activos para el listbox de "Doctor vinculado" del
// formulario (alta y edición usan el mismo).
async function listDoctoresDisponibles() {
  return repository.listDoctoresActivos();
}

// Resuelve un doctorId submitteado a { id, nombre, apellidos } — usado por
// el controller para volver a pintar el combobox en un re-render por
// error, con exactamente lo que el usuario tenía seleccionado. A
// diferencia de listDoctoresDisponibles(), NO filtra por activo: si el
// usuario ya tenía vinculado un doctor que mientras tanto se dio de baja,
// un reintento fallido (p.ej. username duplicado) no debe "perder" esa
// selección de la pantalla.
async function resolverDoctor(rawDoctorId) {
  const doctorId = parseDoctorId(rawDoctorId);
  if (doctorId === null) return null;
  return (await repository.findDoctorVinculado(doctorId)) ?? null;
}

// US-604 (quinta iteración): mismo procedimiento de quitar acentos que
// areas.service.js#slugify (normalize('NFD') + quitar marcas diacríticas),
// duplicado aquí a propósito — cada módulo habla con su propia base, no se
// comparte un helper entre servicios (mismo criterio ya aplicado en el
// resto del proyecto).
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

// AC: dado un prefijo ya usado ("juan.sanchez"), busca el siguiente
// consecutivo disponible. Si el prefijo a secas no existe, se usa tal
// cual — nunca se le agrega ".2" a un username que todavía nadie tomó. Si
// existe, se toma el MAYOR sufijo numérico entre los `prefijo.N`
// existentes (ignorando el propio `prefijo` sin sufijo, que no cuenta para
// el cálculo) y se propone `+1` — no el primer hueco libre, tal como pide
// el AC ("juan.sanchez, .2, .4" -> ".5", nunca ".3").
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

// US-604 (quinta iteración) AC: username propuesto a partir de Nombre(s)/
// Apellidos — primera palabra de cada uno, sin acentos/símbolos/mayúsculas,
// unidas con un punto. `excludeId` es para edición (no proponer un
// consecutivo distinto del propio username actual del usuario que se está
// editando, si su nombre/apellido no cambiaron).
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

// Formato de correo razonable (usuario@dominio.tld) — no persigue el
// estándar completo de RFC 5322 (nadie lo implementa completo en la
// práctica), solo bloquea los errores de tecleo obvios que el AC pide
// atrapar (sin "@", sin dominio, con espacios). El campo `type="email"` del
// input ya da una validación básica en el navegador, pero nunca hay que
// confiar solo en eso — se repite aquí en el servidor.
const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCorreo(rawCorreo) {
  const correo = validateTexto(rawCorreo, 'Correo', 150);
  if (!CORREO_REGEX.test(correo)) {
    throw new UsuarioValidationError('El correo no tiene un formato válido.');
  }
  return correo;
}

// Teléfono es opcional en el schema (a diferencia de nombre/apellidos/
// correo/username) — se recorta igual, pero una cadena vacía se guarda
// como NULL en vez de rechazarse.
function parseTelefono(rawTelefono) {
  const telefono = (rawTelefono ?? '').trim();
  return telefono || null;
}

// El listbox de Doctor vinculado es opcional (AC: "el sistema permite
// guardar usuarios.doctor_id = NULL") — un valor vacío/ausente es válido,
// no un error. Cualquier cosa que no sea un entero positivo se descarta en
// silencio (mismo criterio permisivo que el resto del sistema) en vez de
// rechazar todo el formulario por un id corrupto; el FK de
// `usuarios.doctor_id` es el backstop final si de todos modos llegara un
// id que no existe.
function parseDoctorId(rawDoctorId) {
  if (rawDoctorId === undefined || rawDoctorId === null || rawDoctorId === '') return null;
  const id = Number.parseInt(rawDoctorId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Distinto de parseEstatus() de arriba (que también acepta "todos", para
// el FILTRO del listado) — este es el estatus real que se va a GUARDAR al
// editar, nunca "todos". Cualquier valor que no sea uno de los 4 estatus
// válidos cae a "activo", mismo criterio permisivo que el resto del
// formulario (nunca truena por un valor corrupto).
function parseEstatusEdicion(rawEstatus) {
  return ESTATUS_VALUES.includes(rawEstatus) ? rawEstatus : 'activo';
}

// US-604: mismo criterio que parseAreaIds() de doctores.service.js — un
// checkbox group de HTML llega como string (una sola opción marcada),
// array (varias) o ausente (ninguna), nunca como un tipo fijo. Además,
// un valor puede traer VARIOS ids separados por coma — el checkbox
// combinado "Carga y Envío" (ver combinarCargaEnvio) manda un solo
// `value="idCargar,idEnviar"` para otorgar/revocar los dos juntos con un
// solo control visual.
function parsePermissionIds(rawPermisos) {
  const valores = rawPermisos === undefined ? [] : [].concat(rawPermisos);
  const ids = valores
    .flatMap((valor) => String(valor).split(','))
    .map((valor) => Number.parseInt(valor, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

// Orden de columnas pedido por el usuario tras ver el mockup en vivo: Ver
// primero, luego Crear/Editar/Eliminar (el CRUD "estándar" que comparten
// casi todos los módulos), y cualquier acción que no esté en esta lista
// (confirmar, cancelar, carga_envio) cae después, ordenada alfabéticamente.
// Un valor de `accion` nuevo que nunca se vio antes simplemente aterriza en
// el grupo "resto" sin tocar esta lista.
const ORDEN_ACCIONES_PRIORITARIAS = ['ver', 'crear', 'editar', 'eliminar'];

function ordenarAcciones(acciones) {
  const prioritarias = ORDEN_ACCIONES_PRIORITARIAS.filter((accion) => acciones.includes(accion));
  const resto = acciones.filter((accion) => !ORDEN_ACCIONES_PRIORITARIAS.includes(accion)).sort();
  return [...prioritarias, ...resto];
}

// US-604 (segunda iteración): estos dos NUNCA tienen su propio checkbox —
// "editar usuarios incluye permisos y restablecer contraseña" (pedido
// explícito del usuario): quien puede usuarios.editar automáticamente
// puede usuarios.permisos/usuarios.resetear_password también, sin un
// control aparte que se pueda desincronizar. Ver
// aplicarReglaEditarUsuariosIncluyePermisos.
const ACCIONES_SIN_CHECKBOX_PROPIO = ['permisos', 'resetear_password'];

// US-604 (segunda iteración): "Carga y Envío" es UN checkbox visual que
// otorga/revoca los dos permisos reales de laboratorio (`cargar`+`enviar`)
// juntos, nunca por separado (pedido explícito del usuario, mismo criterio
// que editar-incluye-permisos pero visible en vez de implícito). Su "id"
// combinado viaja como `"idCargar,idEnviar"` en el value del checkbox —
// parsePermissionIds() ya sabe partir eso. Solo tiene efecto en módulos que
// de verdad tengan AMBAS acciones (hoy, únicamente `laboratorio`); en
// cualquier otro módulo es un no-op.
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

// US-604 (segunda iteración): agrupación por TABS (no una sola tabla larga)
// pedida por el usuario para eliminar el scroll de la matriz original —
// cada tab tiene su propio set de columnas (solo las acciones que de
// verdad usan sus módulos, no la unión de las 10+ del catálogo completo).
// EXACTAMENTE 3 tabs (pedido explícito: "no te pedí Otros, dije 3
// opciones") — un módulo que no esté en ninguno de los tres simplemente no
// aparece en la matriz. Los módulos fijos originales `agenda`/`grooming`
// (US-000) siguen existiendo en `permissions` sin tocar, para no romper el
// gate real de /agenda.html y /grooming.html en app.js, pero
// deliberadamente NO se exponen aquí — el tab "Agendas" usa en su lugar el
// catálogo granular `agenda.<categoria>.*` (ver construirTabAgendas).
// Orden de secciones pedido explícitamente: Tutores y pacientes, luego
// Laboratorio, luego Métricas al final.
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
  secciones: [{ titulo: null, modulos: ['usuarios', 'doctores', 'areas', 'plantillas'] }],
};

// Arma un tab a partir de su lista de secciones/módulos y el catálogo ya
// agrupado por módulo — devuelve `null` si NINGUNO de sus módulos existe
// todavía en el catálogo (para que el tab completo no aparezca, en vez de
// mostrarse vacío). Las columnas (`acciones`) son la unión SOLO de las
// acciones presentes en los módulos de ESTE tab, no de todo el catálogo —
// así "Configuraciones" no arrastra columnas de Laboratorio ni viceversa.
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

// US-604 (cuarta iteración) AC: el tab "Agendas" trae sus filas de la tabla
// `areas` EN VIVO (pedido explícito: "estos valores se deben de obtener de
// la tabla de areas"), no de un catálogo fijo — cada área ACTIVA se
// empareja por `slug` contra el módulo `agenda_<slug>` sembrado en
// 01_permissions.js (AGENDA_CATEGORIAS). Un área sin permisos
// aprovisionados para su slug (una nueva, distinta a las 8 que
// 06_areas_agenda.js siembra de arranque) simplemente no aparece en este
// tab — no truena, y su nombre se lee de `area.nombre` en vivo (nunca de
// un mapa de etiquetas estático), así una renombrada de área se refleja
// sola sin tocar código.
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

// US-604 AC: la matriz se organiza "por módulo", con una columna por cada
// acción distinta que exista en el catálogo — cuando un módulo no tiene
// cierta acción, esa celda queda `null` (el partial no dibuja checkbox
// ahí). Un permiso nuevo agregado a `permissions` aparece solo con recargar
// el formulario, sin tocar esta función (AC explícito). Se arma como
// EXACTAMENTE 3 tabs que reflejan el menú real de la aplicación (ver
// TAB_MENU_PRINCIPAL/construirTabAgendas/TAB_CONFIGURACIONES) — sin un tab
// "Otros" de resiliencia (descartado explícitamente por el usuario);
// usuarios.permisos/usuarios.resetear_password nunca tienen checkbox
// propio (van implícitos en usuarios.editar), y laboratorio.cargar/
// laboratorio.enviar se presentan como un único checkbox "Carga y Envío".
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

// US-604: catálogo completo, para construir la matriz del formulario.
async function obtenerCatalogoPermisos() {
  return repository.listPermissionsCatalog();
}

// US-604 (cuarta iteración): áreas activas, para las filas en vivo del tab
// "Agendas" (ver construirTabAgendas).
async function listAreasParaPermisos() {
  return repository.listAreasActivas();
}

// US-604: ids ya asignados a un usuario, para precargar los checkboxes en
// edición — vacío en alta (usuario nuevo, sin id todavía).
async function permisosAsignadosDe(usuarioId) {
  if (!usuarioId) return [];
  return repository.listPermisosUsuario(usuarioId);
}

const CODIGO_PERMISO_ADMINISTRAR_PERMISOS = 'usuarios.permisos';

// US-604 AC: si se está retirando usuarios.permisos de este usuario (lo
// tenía antes, ya no viene en la selección), y no queda ningún OTRO usuario
// activo con ese mismo permiso, la edición se rechaza — sin esto sería
// posible que la clínica se quede sin nadie capaz de volver a otorgar
// permisos. No aplica en alta (un usuario nuevo nunca "retira" nada).
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

// US-604 (segunda iteración) AC: "si un usuario puede editar usuarios,
// entonces que pueda editar permisos y restablecer contraseña". Como esos
// dos ya no tienen checkbox propio (ACCIONES_SIN_CHECKBOX_PROPIO), la única
// forma de que un usuario los tenga es este otorgamiento automático cuando
// usuarios.editar está seleccionado. Si usuarios.editar NO está
// seleccionado no se agrega nada — y como tampoco hay forma de marcarlos
// por su cuenta, el diff de usuario_permisos los retira solos si el
// usuario ya los tenía de antes (mismo comportamiento que cualquier otro
// permiso que se deja de marcar).
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

// US-604 (quinta iteración) AC pedida por el usuario: "no se puede ni
// crear, ni editar, ni eliminar... algo que no se puede ver" — si
// cualquier otra acción de un módulo viene seleccionada, "ver" de ESE
// MISMO módulo se agrega si faltaba. Es deliberadamente de una sola
// dirección (solo AGREGA "ver", nunca QUITA las demás acciones) — mismo
// criterio que aplicarReglaEditarUsuariosIncluyePermisos: el servidor es
// un backstop de defensa en profundidad contra una petición directa que se
// salte el JS del formulario (usuarios.ejs ya hace el intercambio completo
// en vivo, incluyendo "quitar Ver quita toda la fila" — ese lado de la
// regla es puramente de UX en el cliente, el servidor nunca borra una
// selección explícita del administrador).
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

// US-602 AC: alta — sin id. `username`/`correo` son únicos de verdad a
// nivel de base de datos (constraint del script original), así que el
// chequeo aquí (case-insensitive) es la validación amigable antes de
// llegar a ese constraint; siempre se rechaza si ya existe, sin importar
// el estatus del registro que lo tenía (a diferencia de areas/plantillas,
// aquí NO hay "reactivar" — la baja/reactivación de una cuenta es un
// mecanismo completamente aparte del alta, ver US-603/editar()).
// US-604: `permisos` llega sin importar si el formulario mostró o no el
// apartado (un usuario sin usuarios.permisos simplemente no manda ningún
// checkbox marcado) — a diferencia de editar(), en alta no hace falta
// distinguir "sección ausente" de "nada seleccionado": un usuario nuevo
// jamás tiene permisos previos que proteger, así que ambos casos producen
// el mismo resultado (no se inserta ninguna fila en usuario_permisos).
async function crear({
  nombre: rawNombre,
  apellidos: rawApellidos,
  correo: rawCorreo,
  telefono: rawTelefono,
  username: rawUsername,
  password: rawPassword,
  doctorId: rawDoctorId,
  permisos: rawPermisos,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre', 100);
  const apellidos = validateTexto(rawApellidos, 'Apellidos', 100);
  const correo = validateCorreo(rawCorreo);
  const username = validateTexto(rawUsername, 'Username', 50);
  const telefono = parseTelefono(rawTelefono);

  const password = rawPassword ?? '';
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new UsuarioValidationError(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
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
    permissionIds,
    usuarioId,
  });
}

// US-602 AC: edición — con id, actualiza datos generales + estatus; NUNCA
// toca password_hash (el campo de contraseña ni siquiera se muestra en
// edición, el reseteo es una historia aparte, US-605). US-602 (octava
// iteración) AC: el vínculo con un doctor tampoco se puede tocar desde
// edición — a propósito NO hay un parámetro `doctorId` aquí (mismo criterio
// que `password`, que tampoco es parámetro de esta función); el valor
// original simplemente nunca se toca porque `repository.update()` ya ni
// siquiera incluye esa columna en su UPDATE.
// US-604: `permisosProvistos` distingue "el apartado de Permisos no se
// mostró" (quien edita no tiene usuarios.permisos) de "se mostró y se
// dejaron todos los checkboxes sin marcar" — el controller arma este flag a
// partir de un campo oculto que solo viaja cuando el apartado sí se
// renderizó (ver usuario-form.ejs). Cuando es false, ni se valida ni se
// toca usuario_permisos.
async function editar({
  id,
  nombre: rawNombre,
  apellidos: rawApellidos,
  correo: rawCorreo,
  telefono: rawTelefono,
  username: rawUsername,
  estatus: rawEstatus,
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
    permissionIds,
    usuarioId,
  });
}

// US-603 AC: baja lógica desde el listado (no el formulario) — un id
// inválido/inexistente no truena, mismo criterio permisivo que el resto del
// módulo. El único rechazo real que valida el service es "propia cuenta"
// (AC explícito); la idempotencia ("ya estaba inactivo, no vuelve a
// ejecutar la operación") y la invalidación de sesión viven en
// `repository.darDeBaja` — no hace falta leer el estatus actual aquí para
// decidir nada, la propia query del repository ya es atómica al respecto.
async function darDeBaja(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  if (id === usuarioId) {
    throw new NoPuedeDarDeBajaPropiaCuentaError();
  }
  await repository.darDeBaja(id, usuarioId);
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
  crear,
  editar,
  darDeBaja,
  UsuarioValidationError,
  DuplicateUsernameError,
  DuplicateCorreoError,
  UltimoAdministradorPermisosError,
  NoPuedeDarDeBajaPropiaCuentaError,
  DoctorYaVinculadoError,
};
