const bcrypt = require('bcrypt');
const repository = require('./perfil.repository');
const { assertPasswordValida } = require('../../config/passwordPolicy');

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

const BCRYPT_COST = 12;

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

const TELEFONO_REGEX = /^(\d{2}-\d{4}-\d{4}|\d{3}-\d{3}-\d{4})$/;

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

const AVATARES_VALIDOS = ['icon_hospvet', 'icon_cat', 'icon_dog', 'img_doctor', 'img_doctora'];

function validateAvatar(rawAvatar) {
  const avatar = (rawAvatar ?? '').trim();
  if (!AVATARES_VALIDOS.includes(avatar)) {
    throw new PerfilValidationError('Selecciona un ícono válido.');
  }
  return avatar;
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
