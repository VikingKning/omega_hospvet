const repository = require('./tutores.repository');

class TutorValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class RequiereConfirmacionReactivacionError extends Error {
  constructor(tutorExistente) {
    super('El teléfono ya pertenece a un propietario inactivo.');
    this.tutorExistente = tutorExistente;
  }
}

const PAGE_SIZE = 10;
const NOMBRE_TUTOR_MAX = 150;
const APELLIDOS_TUTOR_MAX = 150;
const NOMBRE_PACIENTE_MAX = 100;
const TIPO_PACIENTE_MAX = 20;
const RAZA_PACIENTE_MAX = 100;
const SEXO_PACIENTE_VALORES = ['Macho', 'Hembra'];
const EDAD_PACIENTE_MAX = 40;
const NHC_MAX = 99999999;
const FORMATO_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

function parsePage(rawPage) {
  const page = Number.parseInt(rawPage, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateTexto(rawValor, etiqueta, maxLength) {
  const valor = (rawValor ?? '').trim();
  if (!valor) {
    throw new TutorValidationError(`El campo ${etiqueta} es obligatorio.`);
  }
  if (valor.length > maxLength) {
    throw new TutorValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

function validateTextoOpcional(rawValor, etiqueta, maxLength) {
  const valor = (rawValor ?? '').trim();
  if (!valor) return '';
  if (valor.length > maxLength) {
    throw new TutorValidationError(
      `El campo ${etiqueta} no puede tener más de ${maxLength} caracteres.`,
    );
  }
  return valor;
}

function validateTelefono(rawTelefono) {
  const telefono = (rawTelefono ?? '').trim();
  if (!telefono) {
    throw new TutorValidationError('El campo Teléfono es obligatorio.');
  }
  if (!TELEFONO_REGEX.test(telefono)) {
    throw new TutorValidationError(
      'El teléfono debe tener el formato NN-NNNN-NNNN o NNN-NNN-NNNN.',
    );
  }
  return stripTelefono(telefono);
}

function validateCorreo(rawCorreo) {
  const correo = (rawCorreo ?? '').trim();
  if (!correo) return null;
  if (!FORMATO_CORREO.test(correo)) {
    throw new TutorValidationError('El correo no tiene un formato válido.');
  }
  return correo;
}

function validateSexo(rawValor, etiqueta) {
  const valor = (rawValor ?? '').trim();
  if (!valor) return '';
  if (!SEXO_PACIENTE_VALORES.includes(valor)) {
    throw new TutorValidationError(`El campo ${etiqueta} no es válido.`);
  }
  return valor;
}

function validateEdad(rawValor, etiqueta) {
  const valor = (rawValor ?? '').toString().trim();
  if (!valor) return null;
  const edad = Number(valor);
  if (!Number.isInteger(edad) || edad < 0 || edad > EDAD_PACIENTE_MAX) {
    throw new TutorValidationError(
      `El campo ${etiqueta} debe ser un número entero entre 0 y ${EDAD_PACIENTE_MAX}.`,
    );
  }
  return edad;
}

function validateNhc(rawValor, etiqueta) {
  const valor = (rawValor ?? '').toString().trim();
  if (!valor) return null;
  if (!/^\d{1,8}$/.test(valor)) {
    throw new TutorValidationError(
      `El campo ${etiqueta} debe contener únicamente un número de hasta 8 dígitos.`,
    );
  }
  const nhc = Number(valor);
  if (!Number.isInteger(nhc) || nhc < 0 || nhc > NHC_MAX) {
    throw new TutorValidationError(`El campo ${etiqueta} no es válido.`);
  }
  return nhc;
}

function edadAAnioNacimiento(edad) {
  if (edad === null) return null;
  return new Date().getFullYear() - edad;
}

function edadDesdeAnioNacimiento(anioNacimiento) {
  if (anioNacimiento === null || anioNacimiento === undefined) return null;
  return new Date().getFullYear() - anioNacimiento;
}

function parsePacientes(rawPacientes) {
  const valores = Array.isArray(rawPacientes) ? rawPacientes : [];
  const nhcCapturados = new Set();
  return valores.map((paciente, index) => {
    const nhc = validateNhc(paciente?.nhc, `NHC del paciente ${index + 1}`);
    if (nhc !== null && nhcCapturados.has(nhc)) {
      throw new TutorValidationError(`El NHC ${nhc} está repetido entre los pacientes capturados.`);
    }
    if (nhc !== null) nhcCapturados.add(nhc);
    const nombre = validateTexto(
      paciente?.nombre,
      `Nombre del paciente ${index + 1}`,
      NOMBRE_PACIENTE_MAX,
    );
    const tipo = validateTextoOpcional(
      paciente?.tipo,
      `Tipo del paciente ${index + 1}`,
      TIPO_PACIENTE_MAX,
    );
    const raza = validateTextoOpcional(
      paciente?.raza,
      `Raza del paciente ${index + 1}`,
      RAZA_PACIENTE_MAX,
    );
    const sexo = validateSexo(paciente?.sexo, `Sexo del paciente ${index + 1}`);
    const edad = validateEdad(paciente?.edad, `Edad del paciente ${index + 1}`);
    const id = parseId(paciente?.id);
    const activo = id === null ? true : paciente?.activo !== false;
    return {
      id,
      nhc,
      nombre,
      tipo,
      raza,
      sexo,
      anioNacimiento: edadAAnioNacimiento(edad),
      activo,
    };
  });
}

function pacientesConEdad(pacientes) {
  return pacientes.map((p) => ({ ...p, edad: edadDesdeAnioNacimiento(p.anio_nacimiento) }));
}

function normalizeEstado(rawEstado) {
  return rawEstado === 'todos' ? 'todos' : 'activos';
}

function includes(valor, qLower) {
  return (valor ?? '').toLowerCase().includes(qLower);
}

function tutorCoincide(tutor, qLower, qDigits) {
  return (
    includes(tutor.nombre, qLower) ||
    includes(tutor.apellidos, qLower) ||
    includes(`${tutor.nombre} ${tutor.apellidos}`, qLower) ||
    (qDigits && (tutor.telefono ?? '').includes(qDigits)) ||
    includes(tutor.correo, qLower)
  );
}

function mascotaCoincide(mascota, qLower) {
  const nhcBuscado = /^\d{1,8}$/.test(qLower) ? Number(qLower) : null;
  return (
    (nhcBuscado !== null && mascota.nhc === nhcBuscado) ||
    includes(mascota.nombre, qLower) ||
    includes(mascota.tipo, qLower) ||
    includes(mascota.raza, qLower)
  );
}

function esErrorNhcDuplicado(err) {
  return err?.code === '23505' && err?.constraint === 'mascotas_nhc_unique';
}

async function persistirConNhcUnico(operacion) {
  try {
    return await operacion();
  } catch (err) {
    if (esErrorNhcDuplicado(err)) {
      throw new TutorValidationError('El NHC ya está asignado a otro paciente.');
    }
    throw err;
  }
}

async function list({
  q: rawQ,
  estadoTutores: rawEstadoTutores,
  estadoPacientes: rawEstadoPacientes,
  page: rawPage,
}) {
  const q = (rawQ ?? '').trim();
  const qDigits = stripTelefono(q);
  const estadoTutores = normalizeEstado(rawEstadoTutores);
  const estadoPacientes = normalizeEstado(rawEstadoPacientes);
  const activoTutores = estadoTutores === 'activos';
  const activoPacientes = estadoPacientes === 'activos';
  const page = parsePage(rawPage);

  const filtrosTutores = {
    q: q || undefined,
    qDigits: qDigits || undefined,
    activoTutores,
    activoPacientes,
  };

  const [total, catalogoVacio] = await Promise.all([
    repository.count(filtrosTutores),
    repository.existsAny().then((exists) => !exists),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const offset = (clampedPage - 1) * PAGE_SIZE;

  const tutoresRows = await repository.findPage({ ...filtrosTutores, limit: PAGE_SIZE, offset });
  const tutorIds = tutoresRows.map((tutor) => tutor.id);
  const mascotasRows = tutorIds.length
    ? await repository.mascotasPorPropietarios(tutorIds, { activoPacientes })
    : [];

  const mascotasPorTutor = new Map();
  for (const mascota of mascotasRows) {
    if (!mascotasPorTutor.has(mascota.propietario_id))
      mascotasPorTutor.set(mascota.propietario_id, []);
    mascotasPorTutor.get(mascota.propietario_id).push(mascota);
  }

  const qLower = q.toLowerCase();
  const tutores = tutoresRows.map((tutor) => {
    let pacientes = mascotasPorTutor.get(tutor.id) ?? [];
    if (q && !tutorCoincide(tutor, qLower, qDigits)) {
      pacientes = pacientes.filter((mascota) => mascotaCoincide(mascota, qLower));
    }
    return { ...tutor, telefono: formatTelefono(tutor.telefono), pacientes };
  });

  return {
    tutores,
    total,
    catalogoVacio,
    page: clampedPage,
    totalPages,
    pageSize: PAGE_SIZE,
    q,
    estadoTutores,
    estadoPacientes,
  };
}

async function obtenerParaEditar(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const propietario = await repository.findById(id);
  if (!propietario) return undefined;
  const pacientes = await repository.findMascotasByPropietarioId(id);
  return {
    ...propietario,
    telefono: formatTelefono(propietario.telefono),
    pacientes: pacientesConEdad(pacientes),
  };
}

async function crear({
  nombre: rawNombre,
  apellidos: rawApellidos,
  telefono: rawTelefono,
  correo: rawCorreo,
  pacientes: rawPacientes,
  confirmarReactivacion,
  usuarioId,
}) {
  const nombre = validateTexto(rawNombre, 'Nombre', NOMBRE_TUTOR_MAX);
  const apellidos = validateTexto(rawApellidos, 'Apellidos', APELLIDOS_TUTOR_MAX);
  const telefono = validateTelefono(rawTelefono);
  const correo = validateCorreo(rawCorreo);
  const pacientes = parsePacientes(rawPacientes);

  const existente = await repository.findByTelefono(telefono);
  if (existente) {
    if (existente.activo) {
      throw new TutorValidationError('El teléfono ya se encuentra registrado.');
    }
    if (!confirmarReactivacion) {
      throw new RequiereConfirmacionReactivacionError({
        nombre: existente.nombre,
        apellidos: existente.apellidos,
        telefono: formatTelefono(existente.telefono),
      });
    }
    return persistirConNhcUnico(() =>
      repository.reactivar({
        id: existente.id,
        nombre,
        apellidos,
        telefono,
        correo,
        pacientes,
        usuarioId,
      }),
    );
  }

  return persistirConNhcUnico(() =>
    repository.crear({ nombre, apellidos, telefono, correo, pacientes, usuarioId }),
  );
}

function normalizeActivoOpcional(rawActivo) {
  return typeof rawActivo === 'boolean' ? rawActivo : undefined;
}

async function editar({
  id: rawId,
  nombre: rawNombre,
  apellidos: rawApellidos,
  telefono: rawTelefono,
  correo: rawCorreo,
  activo: rawActivo,
  pacientes: rawPacientes,
  usuarioId,
}) {
  const id = parseId(rawId);
  const nombre = validateTexto(rawNombre, 'Nombre', NOMBRE_TUTOR_MAX);
  const apellidos = validateTexto(rawApellidos, 'Apellidos', APELLIDOS_TUTOR_MAX);
  const telefono = validateTelefono(rawTelefono);
  const correo = validateCorreo(rawCorreo);
  const activo = normalizeActivoOpcional(rawActivo);
  const pacientes = parsePacientes(rawPacientes);

  const existente = await repository.findByTelefono(telefono, id);
  if (existente) {
    throw new TutorValidationError('El teléfono ya se encuentra registrado.');
  }

  await persistirConNhcUnico(() =>
    repository.editar({
      id,
      nombre,
      apellidos,
      telefono,
      correo,
      activo,
      pacientes,
      usuarioId,
    }),
  );
  return id;
}

const BUSQUEDA_TELEFONO_LIMIT = 8;
const BUSQUEDA_MASCOTA_LIMIT = 8;

async function buscarPorTelefono(rawQ) {
  const q = stripTelefono(rawQ);
  const resultados = await repository.searchByTelefono(q, BUSQUEDA_TELEFONO_LIMIT);
  return resultados.map((r) => ({ ...r, telefono: formatTelefono(r.telefono) }));
}

async function buscarMascotas(rawQ) {
  const q = (rawQ ?? '').trim();
  const qDigits = stripTelefono(q);
  return repository.searchMascotas(q || undefined, qDigits || undefined, BUSQUEDA_MASCOTA_LIMIT);
}

async function resolverMascota(rawId) {
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await repository.findMascotaById(id)) ?? null;
}

async function resolverPacienteActivoPorNhc(rawNhc) {
  const nhc = validateNhc(rawNhc, 'NHC');
  if (nhc === null) return null;
  const paciente = await repository.findMascotaActivaByNhc(nhc);
  if (!paciente) return null;
  const tutor = await resolverTutorPorId(paciente.propietario_id);
  if (!tutor) return null;
  return { tutor, pacienteId: paciente.id };
}

async function verificarTelefono(rawTelefono) {
  const telefono = stripTelefono(rawTelefono);
  const existente = await repository.findByTelefono(telefono);
  if (!existente) return { existe: false };
  if (existente.activo) {
    return {
      existe: true,
      activo: true,
      tutor: { id: existente.id, nombre: existente.nombre, apellidos: existente.apellidos },
    };
  }
  const pacientes = await repository.findMascotasByPropietarioId(existente.id);
  return {
    existe: true,
    activo: false,
    tutor: {
      id: existente.id,
      nombre: existente.nombre,
      apellidos: existente.apellidos,
      telefono: formatTelefono(existente.telefono),
      correo: existente.correo,
      pacientes: pacientesConEdad(pacientes),
    },
  };
}

async function resolverTutorActivoPorTelefono(rawTelefono) {
  const telefono = stripTelefono(rawTelefono);
  if (telefono.length !== 10) return null;
  const existente = await repository.findByTelefono(telefono);
  if (!existente || !existente.activo) return null;
  const pacientes = await repository.findMascotasByPropietarioId(existente.id);
  return {
    id: existente.id,
    nombre: existente.nombre,
    apellidos: existente.apellidos,
    telefono: formatTelefono(existente.telefono),
    correo: existente.correo,
    pacientes: pacientesConEdad(pacientes).filter((p) => p.activo),
  };
}

async function buscarActivosPorNombre(rawQ) {
  const q = (rawQ ?? '').trim();
  if (q.length < 2) return [];
  const tutores = await repository.findActivosPorNombre(q, 10);
  return tutores.map((t) => ({
    id: t.id,
    nombre: t.nombre,
    apellidos: t.apellidos,
    telefono: formatTelefono(t.telefono),
  }));
}

async function obtenerPacientesConEdad(propietarioId) {
  const pacientes = await repository.findMascotasByPropietarioId(propietarioId);
  return pacientesConEdad(pacientes);
}

async function resolverTutorPorId(propietarioId) {
  const existente = await repository.findById(propietarioId);
  if (!existente) return null;
  const pacientes = await repository.findMascotasByPropietarioId(existente.id);
  return {
    id: existente.id,
    nombre: existente.nombre,
    apellidos: existente.apellidos,
    telefono: formatTelefono(existente.telefono),
    correo: existente.correo,
    pacientes: pacientesConEdad(pacientes).filter((p) => p.activo),
  };
}

async function desactivar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.desactivar(id, usuarioId);
}

module.exports = {
  list,
  obtenerParaEditar,
  crear,
  editar,
  buscarPorTelefono,
  buscarMascotas,
  resolverMascota,
  resolverPacienteActivoPorNhc,
  verificarTelefono,
  resolverTutorActivoPorTelefono,
  resolverTutorPorId,
  buscarActivosPorNombre,
  obtenerPacientesConEdad,
  desactivar,
  TutorValidationError,
  RequiereConfirmacionReactivacionError,
};
