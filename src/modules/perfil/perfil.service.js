const bcrypt = require('bcrypt');
const repository = require('./perfil.repository');
const { assertPasswordValida } = require('../../config/passwordPolicy');

// Mismo patrón de errores con `.status` que el resto de los módulos — el
// controller los atrapa para re-renderizar el formulario con el mensaje,
// en vez de un 400/409 JSON crudo (este formulario tampoco es una API).
class PerfilValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class DuplicateCorreoError extends Error {
  constructor() {
    super('El correo ya está registrado.');
    this.status = 409;
  }
}

// US-110: mismo costo que el resto del sistema (usuarios.service.js#BCRYPT_COST,
// auth.service.js#DUMMY_HASH).
const BCRYPT_COST = 12;

// US-109 AC: identifica al usuario EXCLUSIVAMENTE a partir de la sesión —
// nunca recibe ni acepta un id desde la interfaz. `usuarios.service.js`
// duplica varios de estos mismos helpers (validateTexto/validateCorreo);
// se repiten aquí a propósito, mismo criterio de independencia entre
// módulos ya aplicado en el resto del proyecto.
function validateTexto(rawValor, etiqueta, maxLength) {
  const valor = (rawValor ?? '').trim();
  if (!valor) {
    throw new PerfilValidationError(`El campo ${etiqueta} es obligatorio.`);
  }
  if (maxLength && valor.length > maxLength) {
    throw new PerfilValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCorreo(rawCorreo) {
  const correo = validateTexto(rawCorreo, 'Correo', 150);
  if (!CORREO_REGEX.test(correo)) {
    throw new PerfilValidationError('El correo no tiene un formato válido.');
  }
  return correo;
}

// US-109 AC9: "valida que el valor cumpla con el formato y longitud
// permitidos" — mismo formato que ya pide el atributo `pattern` del campo
// Teléfono en usuario-form.ejs (10 dígitos), pero validado aquí también del
// lado del servidor (el `pattern` del HTML es solo una ayuda visual, nunca
// la única barrera). Opcional: vacío es válido (AC8), se guarda como NULL.
//
// Ajuste posterior, pedido explícito del usuario: la máscara ya NO es fija
// — un teléfono que empieza con 55 o 56 (CDMX/Edomex) sigue siendo
// NN-NNNN-NNNN (2-4-4); cualquier otro prefijo pasa a NNN-NNN-NNNN (3-3-4).
// El regex acepta ambas formas sin comprobar que el agrupamiento coincida
// con el prefijo — esa consistencia la garantiza la máscara en vivo del
// cliente (mismo criterio duplicado en tutores.service.js#TELEFONO_REGEX).
const TELEFONO_REGEX = /^(\d{2}-\d{4}-\d{4}|\d{3}-\d{3}-\d{4})$/;

// Ajuste posterior, pedido explícito del usuario: el formato con guiones
// es solo "look and feel" — lo que se guarda en `usuarios.telefono` (esta
// tabla también, vía el mismo repository que Mi Perfil actualiza) son los
// 10 dígitos, sin guiones (ver migración
// 20260819000001_normalizar_telefonos_sin_guiones.js). Mismo criterio de
// independencia entre módulos — duplicado de
// tutores.service.js#stripTelefono/formatTelefono, no importado.
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

function validateTelefono(rawTelefono) {
  const telefono = (rawTelefono ?? '').trim();
  if (!telefono) return null;
  if (!TELEFONO_REGEX.test(telefono)) {
    throw new PerfilValidationError(
      'El teléfono debe tener el formato NN-NNNN-NNNN o NNN-NNN-NNNN.',
    );
  }
  return stripTelefono(telefono);
}

// Pedido explícito del usuario: 5 íconos fijos para mostrarse en la barra
// de título (ver perfil.ejs, sección "Datos personales") — whitelist real,
// nunca se confía en que el cliente mande uno de estos 5 valores solo
// porque el picker del formulario solo ofrece esos (mismo criterio que
// SEXO_PACIENTE_VALORES en tutores.service.js). Los nombres coinciden
// exactamente con el archivo en assets/imgs (sin extensión) — la vista
// arma la ruta completa (`assets/imgs/${avatar}.png`).
const AVATARES_VALIDOS = ['icon_hospvet', 'icon_cat', 'icon_dog', 'img_doctor', 'img_doctora'];

function validateAvatar(rawAvatar) {
  const avatar = (rawAvatar ?? '').trim();
  if (!AVATARES_VALIDOS.includes(avatar)) {
    throw new PerfilValidationError('Selecciona un ícono válido.');
  }
  return avatar;
}

// ---------------------------------------------------------------------
// Matriz de permisos de solo lectura (sección "Permisos" de Mi perfil).
//
// Copia deliberada de usuarios.service.js#construirMatrizPermisos y sus
// funciones auxiliares (mismo criterio de independencia entre módulos que
// el resto de este archivo) — construye EXACTAMENTE la misma forma de
// datos (3 tabs fijos, columnas = acciones presentes, "Carga y Envío"
// combinado) para que la vista de solo lectura se sienta igual a la
// matriz editable de "Editar usuario". La única diferencia real vive en la
// vista: ahí un checkbox decide si un permiso SE OTORGA, aquí un ícono de
// check decide si el usuario YA LO TIENE (perfilAsignadosIds, calculado en
// obtener() más abajo).
// ---------------------------------------------------------------------

const ORDEN_ACCIONES_PRIORITARIAS = ['ver', 'crear', 'editar', 'eliminar'];

function ordenarAcciones(acciones) {
  const prioritarias = ORDEN_ACCIONES_PRIORITARIAS.filter((accion) => acciones.includes(accion));
  const resto = acciones.filter((accion) => !ORDEN_ACCIONES_PRIORITARIAS.includes(accion)).sort();
  return [...prioritarias, ...resto];
}

// "usuarios.editar implica permisos+resetear_password" — igual que en la
// matriz editable, estas dos acciones nunca tienen columna propia aquí
// tampoco (mostrarlas por separado sugeriría que se pueden otorgar solas).
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
  secciones: [{ titulo: null, modulos: ['usuarios', 'doctores', 'areas', 'plantillas'] }],
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

function construirMatrizPermisos(catalogo, areasActivas) {
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

// US-109 AC: consulta el perfil propio — un id inválido/inexistente no
// debería poder pasar nunca (viene de req.session.user.id, nunca de la
// interfaz), pero se deja el mismo criterio permisivo que el resto del
// sistema por si acaso (devuelve undefined en vez de tronar).
//
// Extensión (datos ligados a la cuenta): además de los campos propios de
// usuarios, resuelve el doctor vinculado (si hay `doctor_id`), sus
// especialidades y la matriz de permisos otorgados — mismo criterio de
// independencia entre módulos que el resto del archivo: NO se reutiliza
// usuarios.repository.js/doctores.repository.js, perfil.repository.js
// tiene sus propias consultas equivalentes.
async function obtener(usuarioId) {
  const perfil = await repository.findById(usuarioId);
  const [doctor, permisosAsignadosIds, catalogo, areasActivas] = await Promise.all([
    repository.findDoctorVinculado(perfil.doctor_id),
    repository.listPermisosAsignados(usuarioId),
    repository.listPermissionsCatalog(),
    repository.listAreasActivas(),
  ]);
  const areasDoctor = await repository.findAreasDelDoctor(perfil.doctor_id);

  return {
    ...perfil,
    telefono: formatTelefono(perfil.telefono),
    doctor,
    areasDoctor,
    permisosAsignadosIds,
    matrizPermisos: construirMatrizPermisos(catalogo, areasActivas),
  };
}

// US-109 AC: actualiza ÚNICAMENTE nombre/apellidos/telefono/correo/avatar
// del propio usuario. `usuarioId` sale siempre de `req.session.user.id`
// (nunca de un parámetro de la petición) — ver perfil.controller.js.
//
// Extensión: si la cuenta tiene un doctor vinculado, Nombre/Apellidos se
// replican también en `doctores` (pedido explícito del usuario: son el
// mismo dato en dos tablas) — se resuelve `doctor_id` primero para
// pasárselo al repository, que hace ambos updates en una sola transacción.
async function actualizar(
  usuarioId,
  {
    nombre: rawNombre,
    apellidos: rawApellidos,
    telefono: rawTelefono,
    correo: rawCorreo,
    avatar: rawAvatar,
  },
) {
  const nombre = validateTexto(rawNombre, 'Nombre', 100);
  const apellidos = validateTexto(rawApellidos, 'Apellidos', 100);
  const correo = validateCorreo(rawCorreo);
  const telefono = validateTelefono(rawTelefono);
  const avatar = validateAvatar(rawAvatar);

  if (await repository.findByCorreo(correo, usuarioId)) {
    throw new DuplicateCorreoError();
  }

  const actual = await repository.findById(usuarioId);
  await repository.actualizar(usuarioId, {
    nombre,
    apellidos,
    telefono,
    correo,
    avatar,
    doctorId: actual.doctor_id,
  });
  return { nombre, apellidos, telefono: formatTelefono(telefono), correo, avatar };
}

// US-110 AC: "el sistema identifica al usuario exclusivamente a partir de
// la sesión autenticada" — usuarioId sale siempre de req.session.user.id
// (ver perfil.controller.js), mismo criterio que el resto de este módulo.
// Los 3 campos son obligatorios (AC), se valida la actual contra el hash
// real ANTES de comparar nueva/confirmación (AC: "conserva
// usuarios.password_hash sin modificaciones" si la actual no coincide —
// ninguna validación posterior debe ejecutarse innecesariamente ni dar
// pistas sobre por qué falló algo que ni siquiera se llegó a evaluar).
async function cambiarPassword(
  usuarioId,
  { passwordActual: rawActual, passwordNueva: rawNueva, confirmarPassword: rawConfirmar },
) {
  const passwordActual = rawActual ?? '';
  const passwordNueva = rawNueva ?? '';
  const confirmarPassword = rawConfirmar ?? '';

  if (!passwordActual || !passwordNueva || !confirmarPassword) {
    throw new PerfilValidationError(
      'Contraseña actual, Nueva contraseña y Confirmar nueva contraseña son obligatorios.',
    );
  }

  const { password_hash: hashActual } = await repository.findPasswordHash(usuarioId);
  const coincide = await bcrypt.compare(passwordActual, hashActual);
  if (!coincide) {
    throw new PerfilValidationError('La contraseña actual es incorrecta.');
  }

  if (passwordNueva !== confirmarPassword) {
    throw new PerfilValidationError('La nueva contraseña y su confirmación no coinciden.');
  }

  // Decisión 24 (Bitácora v5): política compartida con usuarios.service.js
  // (alta) y auth.service.js (cambio obligatorio) — aquí, a diferencia de
  // esos dos, SÍ se pasa currentPassword: es el único de los 3 que
  // corresponde a un "cambio voluntario" (AC: "la nueva contraseña no
  // puede ser igual a la contraseña actual").
  try {
    await assertPasswordValida(passwordNueva, { currentPassword: passwordActual });
  } catch (err) {
    throw new PerfilValidationError(err.message);
  }

  const passwordHash = await bcrypt.hash(passwordNueva, BCRYPT_COST);
  await repository.actualizarPassword(usuarioId, passwordHash);
}

module.exports = {
  obtener,
  actualizar,
  cambiarPassword,
  PerfilValidationError,
  DuplicateCorreoError,
  AVATARES_VALIDOS,
};
