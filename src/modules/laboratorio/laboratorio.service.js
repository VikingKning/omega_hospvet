const repository = require('./laboratorio.repository');
const tutoresRepository = require('../tutores/tutores.repository');
const tutoresService = require('../tutores/tutores.service');
const doctoresRepository = require('../doctores/doctores.repository');
const archivos = require('./laboratorio.archivos');
const envios = require('./laboratorio.envios');
const env = require('../../config/env');

class LaboratorioValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['fecha', 'mascota', 'estado'];
const ESTADOS_VALIDOS = ['pendiente', 'cargado', 'enviado'];

function stripTelefono(telefono) {
  return (telefono ?? '').replace(/\D/g, '');
}

const COMPONENTES_LIQUIDO = [
  { valor: 'color', etiqueta: 'Color' },
  { valor: 'aspecto', etiqueta: 'Aspecto / turbidez' },
  { valor: 'densidad', etiqueta: 'Densidad' },
  { valor: 'proteinas_totales', etiqueta: 'Proteínas totales' },
  { valor: 'recuento_celular', etiqueta: 'Recuento celular (nucleados)' },
  { valor: 'diferencial_celular', etiqueta: 'Diferencial celular' },
  { valor: 'citologia', etiqueta: 'Citología' },
  { valor: 'cultivo_bacteriano', etiqueta: 'Cultivo bacteriano' },
  { valor: 'ph', etiqueta: 'pH' },
  { valor: 'otros', etiqueta: 'Otros' },
];
const COMPONENTES_LIQUIDO_VALIDOS = COMPONENTES_LIQUIDO.map((c) => c.valor);

const LATERALIDADES_VALIDAS = ['izquierdo', 'derecho', 'bilateral', 'no_aplica'];

const OBSERVACIONES_MAX = 2000;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parsePage(rawPage) {
  const page = Number.parseInt(rawPage, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSort(rawSort) {
  return SORT_COLUMNS.includes(rawSort) ? rawSort : 'fecha';
}

function parseDir(rawDir) {
  return rawDir === 'asc' ? 'asc' : 'desc';
}

function parseId(rawId) {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateFecha(rawValor) {
  const valor = (rawValor ?? '').trim();
  if (!FECHA_REGEX.test(valor)) {
    throw new LaboratorioValidationError(
      'La fecha de solicitud es obligatoria y debe ser una fecha válida.',
    );
  }
  return valor;
}

function validateObservaciones(rawValor, etiqueta) {
  const valor = (rawValor ?? '').toString().trim();
  if (!valor) return null;
  if (valor.length > OBSERVACIONES_MAX) {
    throw new LaboratorioValidationError(
      `El campo ${etiqueta} no puede tener más de ${OBSERVACIONES_MAX} caracteres.`,
    );
  }
  return valor;
}

async function catalogoParaFormulario(estudiosHistoricosIds = []) {
  const [categorias, zonasAnatomicas] = await Promise.all([
    repository.findCatalogo(estudiosHistoricosIds),
    repository.findZonasAnatomicas(),
  ]);
  return { categorias, zonasAnatomicas, componentesLiquido: COMPONENTES_LIQUIDO };
}

async function listCategorias() {
  return repository.findCategorias();
}

async function list({
  q,
  estado,
  categoriaId: rawCategoriaId,
  page: rawPage,
  sort: rawSort,
  dir: rawDir,
}) {
  const trimmedQ = (q ?? '').trim();
  const qDigits = stripTelefono(trimmedQ);
  const estadoFiltro = ESTADOS_VALIDOS.includes(estado) ? estado : undefined;
  const categoriaId = parseId(rawCategoriaId);
  const page = parsePage(rawPage);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = {
    q: trimmedQ || undefined,
    qDigits: qDigits || undefined,
    estado: estadoFiltro,
    categoriaId: categoriaId || undefined,
  };

  const [registros, total, catalogoVacio] = await Promise.all([
    repository.findPage({ ...filters, sort, dir, limit: PAGE_SIZE, offset }),
    repository.count(filters),
    repository.existsAny().then((exists) => !exists),
  ]);

  const estudiosPorRegistro = await repository.estudiosPorRegistros(registros.map((r) => r.id));
  const registrosConEstudios = registros.map((registro) => ({
    ...registro,
    estudios: estudiosPorRegistro
      .filter((e) => e.registro_laboratorio_id === registro.id)
      .map((e) => e.nombre),
  }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    registros: registrosConEstudios,
    total,
    catalogoVacio,
    page: Math.min(page, totalPages),
    totalPages,
    pageSize: PAGE_SIZE,
    q: trimmedQ,
    estado: estadoFiltro ?? '',
    categoriaId: categoriaId ?? '',
    sort,
    dir,
  };
}

async function listarDoctoresActivos(incluirDoctorId = null) {
  return doctoresRepository.findActivos(incluirDoctorId);
}

function parseComponentesLiquido(raw) {
  const valores = raw === undefined ? [] : [].concat(raw);
  return [...new Set(valores.filter((v) => COMPONENTES_LIQUIDO_VALIDOS.includes(v)))];
}

function normalizarEspecie(especie) {
  return (especie ?? '').trim().toLowerCase();
}

async function validarEstudios(
  rawEstudios,
  zonasValidasIds,
  especieMascota,
  estudiosInactivosPermitidosIds = new Set(),
) {
  const lista = Array.isArray(rawEstudios) ? rawEstudios : [];
  if (lista.length === 0) {
    throw new LaboratorioValidationError('Agrega al menos un estudio antes de guardar.');
  }

  const ids = lista.map((e) => parseId(e.estudioId)).filter((id) => id !== null);
  const catalogo = await repository.findEstudiosByIds(ids);
  const catalogoPorId = new Map(catalogo.map((e) => [e.id, e]));

  return lista.map((entrada) => {
    const estudioId = parseId(entrada.estudioId);
    const estudio = estudioId !== null ? catalogoPorId.get(estudioId) : undefined;
    const esEstudioHistorico = Boolean(
      estudio && !estudio.activo && estudiosInactivosPermitidosIds.has(estudio.id),
    );
    if (!estudio || (!estudio.activo && !esEstudioHistorico)) {
      throw new LaboratorioValidationError(
        'Uno de los estudios seleccionados ya no está disponible en el catálogo.',
      );
    }
    if (
      estudio.especie &&
      normalizarEspecie(estudio.especie) !== normalizarEspecie(especieMascota)
    ) {
      throw new LaboratorioValidationError(
        `"${estudio.nombre}" no está disponible para la especie del paciente.`,
      );
    }

    const fila = { estudioId: estudio.id };

    if (estudio.campo_adicional === 'zona') {
      const zonaAnatomicaId = parseId(entrada.zonaAnatomicaId);
      const zonasPermitidasIds = new Set(
        (estudio.zonas_permitidas_ids ?? []).map((id) => Number(id)),
      );
      if (
        zonaAnatomicaId === null ||
        !zonasValidasIds.has(zonaAnatomicaId) ||
        (!esEstudioHistorico && !zonasPermitidasIds.has(zonaAnatomicaId))
      ) {
        throw new LaboratorioValidationError(
          `"${estudio.nombre}" requiere seleccionar una zona anatómica válida.`,
        );
      }
      fila.zonaAnatomicaId = zonaAnatomicaId;
    } else if (estudio.campo_adicional === 'tipo_muestra') {
      const tipoMuestra = (entrada.tipoMuestra ?? '').trim();
      if (!tipoMuestra) {
        throw new LaboratorioValidationError(
          `"${estudio.nombre}" requiere indicar el tipo de muestra.`,
        );
      }
      fila.tipoMuestra = tipoMuestra;
    } else if (estudio.campo_adicional === 'tejido_lateralidad') {
      const tejidoOrigen = (entrada.tejidoOrigen ?? '').trim();
      if (!tejidoOrigen) {
        throw new LaboratorioValidationError(
          `"${estudio.nombre}" requiere indicar el tejido de origen.`,
        );
      }
      fila.tejidoOrigen = tejidoOrigen;
      if (entrada.lateralidad && LATERALIDADES_VALIDAS.includes(entrada.lateralidad)) {
        fila.lateralidad = entrada.lateralidad;
      }
    } else if (estudio.campo_adicional === 'componentes_liquido') {
      const componentesLiquido = parseComponentesLiquido(entrada.componentesLiquido);
      if (componentesLiquido.length === 0) {
        throw new LaboratorioValidationError(
          `"${estudio.nombre}" requiere seleccionar al menos un componente.`,
        );
      }
      fila.componentesLiquido = componentesLiquido;
    }

    if (entrada.antibiograma && !estudio.permite_antibiograma && !esEstudioHistorico) {
      throw new LaboratorioValidationError(
        `"${estudio.nombre}" no permite solicitar antibiograma.`,
      );
    }
    if (
      estudio.permite_antibiograma ||
      (esEstudioHistorico && entrada.antibiograma !== undefined && entrada.antibiograma !== null)
    ) {
      fila.antibiograma = Boolean(entrada.antibiograma);
    }

    const observaciones = validateObservaciones(
      entrada.observaciones,
      `Observaciones de "${estudio.nombre}"`,
    );
    if (observaciones) fila.observaciones = observaciones;

    return fila;
  });
}

async function validarDatosRegistro(
  {
    mascotaId: rawMascotaId,
    doctorId: rawDoctorId,
    fechaSolicitud: rawFechaSolicitud,
    observaciones: rawObservaciones,
    estudios: rawEstudios,
  },
  estudiosInactivosPermitidosIds = new Set(),
) {
  const mascotaId = parseId(rawMascotaId);
  if (mascotaId === null) {
    throw new LaboratorioValidationError('Selecciona un paciente.');
  }
  const mascota = await tutoresRepository.findMascotaById(mascotaId);
  if (!mascota) {
    throw new LaboratorioValidationError('El paciente seleccionado no existe.');
  }

  const doctorId = parseId(rawDoctorId);
  if (doctorId === null) {
    throw new LaboratorioValidationError('Selecciona el doctor solicitante.');
  }

  const fechaSolicitud = validateFecha(rawFechaSolicitud);
  const observaciones = validateObservaciones(rawObservaciones, 'Observaciones generales');

  const zonas = await repository.findZonasAnatomicas();
  const zonasValidasIds = new Set(zonas.map((z) => z.id));
  const estudios = await validarEstudios(
    rawEstudios,
    zonasValidasIds,
    mascota.tipo,
    estudiosInactivosPermitidosIds,
  );

  return { mascotaId, doctorId, fechaSolicitud, observaciones, estudios };
}

async function crear({ usuarioId, ...datos }) {
  const validados = await validarDatosRegistro(datos);
  return repository.crearRegistro({ ...validados, usuarioId });
}

async function editar(rawId, { usuarioId, ...datos }) {
  const id = parseId(rawId);
  if (id === null) {
    throw new LaboratorioValidationError('Registro no encontrado.');
  }
  const registroActual = await repository.findById(id);
  if (!registroActual) {
    throw new LaboratorioValidationError('Registro no encontrado.');
  }
  const estudiosInactivosPermitidosIds = new Set(
    registroActual.estudios.map((estudioActual) => estudioActual.estudio_id),
  );
  const validados = await validarDatosRegistro(datos, estudiosInactivosPermitidosIds);
  await repository.actualizarRegistro(id, { ...validados, usuarioId });
}

async function obtenerParaEditar(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const registro = await repository.findById(id);
  if (!registro) return undefined;

  const pacientesDelTutor = await tutoresService.obtenerPacientesConEdad(registro.propietario_id);

  return { ...registro, pacientesDelTutor };
}

async function resolverTutorPorTelefono(rawTelefono) {
  return tutoresService.resolverTutorActivoPorTelefono(rawTelefono);
}

async function buscarTutoresPorNombre(q) {
  return tutoresService.buscarActivosPorNombre(q);
}

function errorRegistroNoEncontrado() {
  const err = new Error('Registro no encontrado.');
  err.status = 404;
  return err;
}

function formatearCodigoRegistro(id) {
  return `LAB-${String(id).padStart(3, '0')}`;
}

function construirMensajeConflicto(match, registroActualId) {
  const codigo = formatearCodigoRegistro(match.registro_laboratorio_id);
  if (match.registro_laboratorio_id === registroActualId) {
    return `ya se encuentra cargado en este mismo registro (${codigo})`;
  }
  const doctor = match.doctor_nombre ? `Dr. ${match.doctor_nombre} ${match.doctor_apellidos}` : '—';
  return `ya se encuentra asociado a otro registro de laboratorio (${codigo} — paciente ${match.paciente_nombre}, ${doctor})`;
}

async function resolverConflictoDeHashes(registroId, files) {
  const hashesPorArchivo = files.map((file) => ({
    nombre: file.originalname,
    hash: archivos.calcularHash(file.buffer),
  }));
  const hashesUnicos = [...new Set(hashesPorArchivo.map((f) => f.hash))];
  const activos = await repository.buscarArchivosActivosPorHashes(hashesUnicos);
  const activoPorHash = new Map(activos.map((row) => [row.hash_contenido, row]));

  if (files.length === 1) {
    const match = activoPorHash.get(hashesPorArchivo[0].hash);
    if (!match) return null;
    if (match.registro_laboratorio_id === registroId) {
      return { archivoIdExistente: match.id };
    }
    throw new LaboratorioValidationError(
      `Archivo ya registrado: "${hashesPorArchivo[0].nombre}" ${construirMensajeConflicto(match, registroId)} y no puede cargarse nuevamente. Verifica que hayas seleccionado el resultado correspondiente al paciente actual.`,
    );
  }

  const enConflicto = hashesPorArchivo
    .map((f) => ({ ...f, match: activoPorHash.get(f.hash) }))
    .filter((f) => f.match);

  if (enConflicto.length) {
    const detalle = enConflicto
      .map((f) => `"${f.nombre}" ${construirMensajeConflicto(f.match, registroId)}`)
      .join('; ');
    throw new LaboratorioValidationError(
      `Archivo ya registrado: ${detalle} y no puede cargarse nuevamente. Verifica que hayas seleccionado el resultado correspondiente al paciente actual.`,
    );
  }
  return null;
}

async function subirArchivoParaTodos(rawRegistroId, files, usuarioId) {
  const registroId = parseId(rawRegistroId);
  if (registroId === null) throw errorRegistroNoEncontrado();
  const registro = await repository.findById(registroId);
  if (!registro) throw errorRegistroNoEncontrado();

  const conflicto = await resolverConflictoDeHashes(registroId, files);
  if (conflicto) {
    await repository.reutilizarArchivoParaTodos({
      registroId,
      archivoId: conflicto.archivoIdExistente,
      usuarioId,
    });
    return { archivoId: conflicto.archivoIdExistente, reutilizado: true };
  }

  const metadata = await archivos.procesarArchivos({ registroId, files });
  try {
    const archivoId = await repository.registrarArchivoParaTodos({
      registroId,
      metadata,
      usuarioId,
    });
    return { archivoId, reutilizado: false };
  } catch (err) {
    await archivos.eliminarFisico(metadata.rutaAlmacenamiento);
    if (repository.esViolacionHashActivo(err)) {
      const [ganador] = await repository.buscarArchivosActivosPorHashes([metadata.hashContenido]);
      throw new LaboratorioValidationError(
        `Archivo ya registrado: "${metadata.nombreOriginal}" ${construirMensajeConflicto(ganador, registroId)} y no puede cargarse nuevamente. Verifica que hayas seleccionado el resultado correspondiente al paciente actual.`,
      );
    }
    throw err;
  }
}

async function subirArchivoParaEstudio(rawRegistroId, rawEstudioId, files, usuarioId) {
  const registroId = parseId(rawRegistroId);
  const estudioId = parseId(rawEstudioId);
  if (registroId === null || estudioId === null) throw errorRegistroNoEncontrado();
  const registro = await repository.findById(registroId);
  if (!registro) throw errorRegistroNoEncontrado();
  const pertenece = registro.estudios.some((estudio) => estudio.id === estudioId);
  if (!pertenece) throw errorRegistroNoEncontrado();

  const conflicto = await resolverConflictoDeHashes(registroId, files);
  if (conflicto) {
    await repository.reutilizarArchivoParaEstudio({
      registroId,
      estudioId,
      archivoId: conflicto.archivoIdExistente,
      usuarioId,
    });
    return { archivoId: conflicto.archivoIdExistente, reutilizado: true };
  }

  const metadata = await archivos.procesarArchivos({ registroId, files });
  try {
    const archivoId = await repository.registrarArchivoParaEstudio({
      registroId,
      estudioId,
      metadata,
      usuarioId,
    });
    return { archivoId, reutilizado: false };
  } catch (err) {
    await archivos.eliminarFisico(metadata.rutaAlmacenamiento);
    if (repository.esViolacionHashActivo(err)) {
      const [ganador] = await repository.buscarArchivosActivosPorHashes([metadata.hashContenido]);
      throw new LaboratorioValidationError(
        `Archivo ya registrado: "${metadata.nombreOriginal}" ${construirMensajeConflicto(ganador, registroId)} y no puede cargarse nuevamente. Verifica que hayas seleccionado el resultado correspondiente al paciente actual.`,
      );
    }
    throw err;
  }
}

async function eliminarArchivoDeTodos(rawRegistroId, usuarioId) {
  const registroId = parseId(rawRegistroId);
  if (registroId === null) throw errorRegistroNoEncontrado();
  const registro = await repository.findById(registroId);
  if (!registro) throw errorRegistroNoEncontrado();

  await repository.desasignarArchivoDeTodosLosEstudios(registroId, usuarioId);
}

async function eliminarArchivoDeEstudio(rawRegistroId, rawEstudioId, usuarioId) {
  const registroId = parseId(rawRegistroId);
  const estudioId = parseId(rawEstudioId);
  if (registroId === null || estudioId === null) throw errorRegistroNoEncontrado();
  const registro = await repository.findById(registroId);
  if (!registro) throw errorRegistroNoEncontrado();
  const pertenece = registro.estudios.some((estudio) => estudio.id === estudioId);
  if (!pertenece) throw errorRegistroNoEncontrado();

  await repository.desasignarArchivoDeEstudio(estudioId, usuarioId);
  await repository.revertirCargadoSiIncompleto(registroId);
}

async function obtenerArchivoParaDescarga(rawArchivoId) {
  const id = parseId(rawArchivoId);
  if (id === null) return null;
  const archivo = await repository.findArchivoById(id);
  if (!archivo) return null;
  return {
    nombreOriginal: archivo.nombre_original,
    rutaAbsoluta: archivos.rutaAbsolutaDeArchivo(archivo.ruta_almacenamiento),
  };
}

async function enviarResultados(rawRegistroId, usuarioId) {
  const registroId = parseId(rawRegistroId);
  if (registroId === null) throw errorRegistroNoEncontrado();
  const registro = await repository.findById(registroId);
  if (!registro) throw errorRegistroNoEncontrado();

  const faltaArchivo = registro.estudios.some((estudio) => !estudio.archivo_id);
  if (faltaArchivo) {
    throw new LaboratorioValidationError(
      'Todos los estudios deben tener un archivo cargado antes de enviar los resultados.',
    );
  }

  const archivoIds = [...new Set(registro.estudios.map((estudio) => estudio.archivo_id))];
  const filas = await Promise.all(archivoIds.map((id) => repository.findArchivoById(id)));
  const archivosParaEnviar = filas.map((archivo) => ({
    id: archivo.id,
    nombreOriginal: archivo.nombre_original,
    rutaAbsoluta: archivos.rutaAbsolutaDeArchivo(archivo.ruta_almacenamiento),
    mimetype: archivos.mimetypeDeArchivo(archivo.nombre_original),
  }));

  const nombreTutor = `${registro.propietario_nombre} ${registro.propietario_apellidos}`;
  const intentos = {
    correo: Boolean(registro.propietario_correo),
    whatsapp: Boolean(registro.propietario_telefono),
  };

  const [correoResultado, whatsappResultado] = await Promise.allSettled([
    intentos.correo
      ? envios.enviarPorCorreo({
          destinatario: registro.propietario_correo,
          nombreTutor,
          nombreMascota: registro.mascota_nombre,
          fechaSolicitud: registro.fecha_solicitud,
          folioId: registro.id,
          archivos: archivosParaEnviar,
          calendarioCitas: env.enlaces.calendarioCitas,
          googleMapsUrl: env.enlaces.ubicacionMaps,
        })
      : Promise.resolve(null),
    intentos.whatsapp
      ? envios.enviarPorWhatsapp({
          telefono: registro.propietario_telefono,
          nombreTutor,
          nombreMascota: registro.mascota_nombre,
          folioId: registro.id,
          archivos: archivosParaEnviar,
          googleCalendarMeetingUrl: env.enlaces.calendarioCitas,
          googleMapsUrl: env.enlaces.ubicacionMaps,
        })
      : Promise.resolve(null),
  ]);

  const correo = correoResultado.status === 'fulfilled' ? correoResultado.value : null;
  const whatsapp = whatsappResultado.status === 'fulfilled' ? whatsappResultado.value : null;

  const mediosExitosos = [];
  if (correo?.ok) mediosExitosos.push('correo');
  if (whatsapp?.ok) mediosExitosos.push('whatsapp');

  const canalesIntentados = Object.entries(intentos)
    .filter(([, intentado]) => intentado)
    .map(([canal]) => canal);
  const canalIntentado = canalesIntentados.length === 2 ? 'ambos' : (canalesIntentados[0] ?? null);

  if (canalIntentado) {
    await repository.registrarEnvio({
      registroLaboratorioId: registroId,
      canalIntentado,
      medio:
        mediosExitosos.length === 2
          ? 'ambos'
          : mediosExitosos.length === 1
            ? mediosExitosos[0]
            : null,
      destinatarioCorreo: intentos.correo ? registro.propietario_correo : null,
      destinatarioTelefono: intentos.whatsapp ? registro.propietario_telefono : null,
      correoExitoso: intentos.correo ? Boolean(correo?.ok) : null,
      whatsappExitoso: intentos.whatsapp ? Boolean(whatsapp?.ok) : null,
      errorCorreo: intentos.correo && !correo?.ok ? correo?.error : null,
      errorWhatsapp: intentos.whatsapp && !whatsapp?.ok ? whatsapp?.error : null,
      archivoIds,
      usuarioId,
    });
  }

  return {
    correo: { intentado: intentos.correo, enviado: Boolean(correo?.ok), error: correo?.error },
    whatsapp: {
      intentado: intentos.whatsapp,
      enviado: Boolean(whatsapp?.ok),
      error: whatsapp?.error,
    },
  };
}

async function reenviarResultadosPorWhatsapp(
  rawRegistroId,
  { telefono, claveIdempotenciaPrefijo },
) {
  const registroId = parseId(rawRegistroId);
  if (registroId === null) return { ok: false, error: 'Folio inválido.' };
  const registro = await repository.findById(registroId);
  if (!registro) return { ok: false, error: 'Registro no encontrado.' };

  const faltaArchivo =
    registro.estudios.length === 0 || registro.estudios.some((estudio) => !estudio.archivo_id);
  if (faltaArchivo) return { ok: false, error: 'No hay archivos cargados para esta orden.' };

  const archivoIds = [...new Set(registro.estudios.map((estudio) => estudio.archivo_id))];
  const filas = await Promise.all(archivoIds.map((id) => repository.findArchivoById(id)));
  const archivosParaEnviar = filas.map((archivo) => ({
    id: archivo.id,
    nombreOriginal: archivo.nombre_original,
    rutaAbsoluta: archivos.rutaAbsolutaDeArchivo(archivo.ruta_almacenamiento),
    mimetype: archivos.mimetypeDeArchivo(archivo.nombre_original),
  }));

  return envios.enviarPorWhatsapp({
    telefono,
    nombreTutor: `${registro.propietario_nombre} ${registro.propietario_apellidos}`,
    nombreMascota: registro.mascota_nombre,
    folioId: registro.id,
    archivos: archivosParaEnviar,
    googleCalendarMeetingUrl: env.enlaces.calendarioCitas,
    googleMapsUrl: env.enlaces.ubicacionMaps,
    claveIdempotenciaPrefijo,
  });
}

async function eliminar(rawId, usuarioId) {
  const id = parseId(rawId);
  if (id === null) return;
  await repository.eliminar(id, usuarioId);
}

module.exports = {
  catalogoParaFormulario,
  listCategorias,
  list,
  listarDoctoresActivos,
  crear,
  editar,
  obtenerParaEditar,
  resolverTutorPorTelefono,
  buscarTutoresPorNombre,
  subirArchivoParaTodos,
  subirArchivoParaEstudio,
  eliminarArchivoDeTodos,
  eliminarArchivoDeEstudio,
  obtenerArchivoParaDescarga,
  enviarResultados,
  reenviarResultadosPorWhatsapp,
  eliminar,
};
