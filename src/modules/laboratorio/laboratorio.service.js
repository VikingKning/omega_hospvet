const repository = require('./laboratorio.repository');
const tutoresRepository = require('../tutores/tutores.repository');
const tutoresService = require('../tutores/tutores.service');
const doctoresRepository = require('../doctores/doctores.repository');
const archivos = require('./laboratorio.archivos');

// Mismo patrón de errores con `.status` que agenda.service.js/doctores.service.js
// — el controller los atrapa para responder con el mensaje, en vez de un 500
// genérico.
class LaboratorioValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const PAGE_SIZE = 10;
const SORT_COLUMNS = ['fecha', 'mascota', 'estado'];
const ESTADOS_VALIDOS = ['pendiente', 'cargado', 'enviado'];

// Whitelist real de "componentes" para el campo_adicional='componentes_liquido'
// (Análisis de líquidos corporales) — checklist fijo, no texto libre: mismo
// criterio que DURACIONES_VALIDAS en agenda.service.js. Se expone también al
// catálogo del formulario (catalogoParaFormulario) para pintar los checkboxes.
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

// Whitelist real para el campo "Lateralidad" (campo_adicional='tejido_lateralidad')
// — igual criterio que arriba, un <select> del cliente nunca es la fuente de
// verdad de lo que es válido.
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

// Fecha de solicitud: pedido explícito del usuario (mockup de pantalla
// completa) — ya no la fija el servidor a CURRENT_DATE, la captura el
// formulario (`<input type="date">`, por eso YYYY-MM-DD). Requerida.
function validateFecha(rawValor) {
  const valor = (rawValor ?? '').trim();
  if (!FECHA_REGEX.test(valor)) {
    throw new LaboratorioValidationError(
      'La fecha de solicitud es obligatoria y debe ser una fecha válida.',
    );
  }
  return valor;
}

// Observaciones (generales del registro, o de un estudio individual) —
// texto libre opcional, mismo criterio de longitud máxima que el resto del
// sistema (evitar abuso, no una regla de negocio real).
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

// Catálogo completo (categorías + ~600 estudios + zonas anatómicas +
// componentes de líquido) para la isla JSON del formulario "Nuevo registro".
async function catalogoParaFormulario() {
  const [categorias, zonasAnatomicas] = await Promise.all([
    repository.findCatalogo(),
    repository.findZonasAnatomicas(),
  ]);
  return { categorias, zonasAnatomicas, componentesLiquido: COMPONENTES_LIQUIDO };
}

// Catálogo chico (solo id/nombre) para el <select> "Tipo de estudio" del
// toolbar de filtros.
async function listCategorias() {
  return repository.findCategorias();
}

// Query params de un listado GET/POST: se sanean con valores por defecto en
// vez de rechazarse con un error — mismo criterio que doctores.service.js#list.
async function list({
  q,
  estado,
  categoriaId: rawCategoriaId,
  page: rawPage,
  sort: rawSort,
  dir: rawDir,
}) {
  const trimmedQ = (q ?? '').trim();
  const estadoFiltro = ESTADOS_VALIDOS.includes(estado) ? estado : undefined;
  const categoriaId = parseId(rawCategoriaId);
  const page = parsePage(rawPage);
  const sort = parseSort(rawSort);
  const dir = parseDir(rawDir);
  const offset = (page - 1) * PAGE_SIZE;

  const filters = {
    q: trimmedQ || undefined,
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

async function listarDoctoresActivos() {
  return doctoresRepository.findActivos();
}

function parseComponentesLiquido(raw) {
  const valores = raw === undefined ? [] : [].concat(raw);
  return [...new Set(valores.filter((v) => COMPONENTES_LIQUIDO_VALIDOS.includes(v)))];
}

// Valida un estudio del carrito contra el catálogo REAL (nunca lo que mandó
// el cliente en `campoAdicional`) y arma la fila lista para
// laboratorio.repository.js#crearRegistro. Corrige el bug real ya
// encontrado en el mock: hoy se podía agregar "Radiografía" sin zona y el
// carrito mostraba literalmente "undefined" — aquí simplemente se rechaza
// el alta completa si algún estudio no trae su campo adicional obligatorio.
async function validarEstudios(rawEstudios, zonasValidasIds) {
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
    if (!estudio || !estudio.activo) {
      throw new LaboratorioValidationError(
        'Uno de los estudios seleccionados ya no está disponible en el catálogo.',
      );
    }

    const fila = { estudioId: estudio.id };

    if (estudio.campo_adicional === 'zona') {
      const zonaAnatomicaId = parseId(entrada.zonaAnatomicaId);
      if (zonaAnatomicaId === null || !zonasValidasIds.has(zonaAnatomicaId)) {
        throw new LaboratorioValidationError(
          `"${estudio.nombre}" requiere seleccionar una zona anatómica.`,
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
      fila.antibiograma = Boolean(entrada.antibiograma);
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

    // Pedido explícito del usuario (mockup de pantalla completa):
    // "Observaciones del estudio" — texto libre opcional, independiente del
    // campo adicional que le toque a este estudio en particular.
    const observaciones = validateObservaciones(
      entrada.observaciones,
      `Observaciones de "${estudio.nombre}"`,
    );
    if (observaciones) fila.observaciones = observaciones;

    return fila;
  });
}

// Resuelve mascotaId/doctorId/fechaSolicitud/observaciones/estudios — común
// a crear() y editar(), la única diferencia entre ambas es qué hace el
// repository con el resultado (INSERT vs. UPDATE+reemplazar estudios).
async function validarDatosRegistro({
  mascotaId: rawMascotaId,
  doctorId: rawDoctorId,
  fechaSolicitud: rawFechaSolicitud,
  observaciones: rawObservaciones,
  estudios: rawEstudios,
}) {
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
  const estudios = await validarEstudios(rawEstudios, zonasValidasIds);

  return { mascotaId, doctorId, fechaSolicitud, observaciones, estudios };
}

// Alta: una orden con uno o más estudios, en una sola transacción — nace
// `pendiente` (mismo criterio que citas nace `confirmada`: el personal la
// registra directamente, no hace falta un paso de confirmar lo que uno
// mismo acaba de crear).
async function crear({ usuarioId, ...datos }) {
  const validados = await validarDatosRegistro(datos);
  return repository.crearRegistro({ ...validados, usuarioId });
}

// Edición: mismas validaciones que crear(), pero reemplaza el registro
// existente (repository.actualizarRegistro reemplaza los estudios por
// completo, ver el comentario ahí). Un id inválido es un 404 real, no un
// no-op silencioso (a diferencia de eliminar()) — editar algo que no existe
// es un error de navegación, no un caso normal a tolerar.
async function editar(rawId, { usuarioId, ...datos }) {
  const id = parseId(rawId);
  if (id === null) {
    throw new LaboratorioValidationError('Registro no encontrado.');
  }
  const validados = await validarDatosRegistro(datos);
  await repository.actualizarRegistro(id, { ...validados, usuarioId });
}

// Precarga la pantalla de edición/consulta (mismo espíritu que
// tutores.service.js#obtenerParaEditar) — Especie/Sexo/Edad/Raza del
// paciente viajan de solo lectura (ya se capturan en Tutores y Pacientes,
// no se vuelven a pedir aquí).
async function obtenerParaEditar(rawId) {
  const id = parseId(rawId);
  if (id === null) return undefined;
  const registro = await repository.findById(id);
  if (!registro) return undefined;

  // El selector de "Paciente" necesita TODAS las mascotas del mismo tutor
  // (no solo la ya ligada a este registro) por si se quiere cambiar por
  // otra — mismo criterio que precargar "Doctor vinculado" con el catálogo
  // completo, no solo la opción ya elegida.
  const pacientesDelTutor = await tutoresService.obtenerPacientesConEdad(registro.propietario_id);

  return { ...registro, pacientesDelTutor };
}

// "Nuevo registro": arranca de un tutor YA REGISTRADO por su teléfono
// (pedido explícito del usuario) — delegado en tutores.service.js porque
// `propietarios`/`mascotas` son sus tablas (mismo criterio que
// listarDoctoresActivos delegando en doctoresRepository).
async function resolverTutorPorTelefono(rawTelefono) {
  return tutoresService.resolverTutorActivoPorTelefono(rawTelefono);
}

// Combobox "buscar tutor por nombre" — pedido explícito del usuario, para
// cuando no se sabe el teléfono. Delegado en tutores.service.js por el
// mismo motivo que resolverTutorPorTelefono.
async function buscarTutoresPorNombre(q) {
  return tutoresService.buscarActivosPorNombre(q);
}

function errorRegistroNoEncontrado() {
  const err = new Error('Registro no encontrado.');
  err.status = 404;
  return err;
}

// Réplica exacta, en el servidor, del código que ya se muestra en la tabla
// y en el formulario de laboratorio (`laboratorio-panel.ejs`/`laboratorio-
// form.ejs`, 100% client-side, nunca persistido en BD) — para que el
// mensaje de conflicto de abajo señale el mismo identificador que el
// usuario ve en la UI.
function formatearCodigoRegistro(id) {
  return `LAB-${String(id).padStart(3, '0')}`;
}

// Arma la frase de conflicto para UN archivo, según si la coincidencia
// activa vive en este mismo registro (dentro de un lote de 2+, ver abajo)
// o en otro (siempre bloquea, con el detalle del AC: registro/paciente/
// doctor solicitante).
function construirMensajeConflicto(match, registroActualId) {
  const codigo = formatearCodigoRegistro(match.registro_laboratorio_id);
  if (match.registro_laboratorio_id === registroActualId) {
    return `ya se encuentra cargado en este mismo registro (${codigo})`;
  }
  const doctor = match.doctor_nombre ? `Dr. ${match.doctor_nombre} ${match.doctor_apellidos}` : '—';
  return `ya se encuentra asociado a otro registro de laboratorio (${codigo} — paciente ${match.paciente_nombre}, ${doctor})`;
}

// US-409 v2: detecta si algún archivo del lote ya está ACTIVO (estado
// cargado/enviado — un archivo retirado es histórico, nunca bloquea) en
// `archivos_laboratorio`, ANTES de fusionar/guardar nada. El hash se
// calcula sobre cada archivo CRUDO tal cual llegó (nunca sobre el PDF ya
// fusionado, que es contenido nuevo que no puede coincidir con nada
// subido antes).
//
// - 1 solo archivo: sin match → sigue el flujo normal (null). Match en
//   ESTE MISMO registro → no es un conflicto, es "el usuario ya lo tenía
//   cargado" — se reutiliza la fila existente en vez de crear una nueva
//   (se regresa `{ archivoIdExistente }`, el llamador decide qué hacer).
//   Match en OTRO registro → bloqueo duro.
// - 2+ archivos (se van a fusionar en un PDF nuevo): CUALQUIER match, sea
//   del mismo registro o de otro, bloquea el LOTE COMPLETO — decisión
//   explícita del usuario sobre la letra del AC (que solo describe sin
//   ambigüedad el caso de 1 archivo): el resultado de fusionar siempre es
//   contenido nuevo, así que "ya estaba cargado" no tiene un equivalente
//   limpio ahí, y es más simple pedirle al usuario que quite el archivo
//   repetido del lote y reintente.
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

// Carga de archivos de resultados (pedido explícito del usuario) — valida
// que el registro/estudio exista (mismo criterio que el resto del módulo:
// nunca se confía en un id que llega del cliente), delega el trabajo
// pesado (fusionar/guardar en disco) en laboratorio.archivos.js, y
// actualiza registro/estudio en la BD vía el repository. "Un archivo para
// todos" pisa cualquier archivo individual que ya tuviera cada estudio —
// representa el reporte combinado del laboratorio.
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

// Quitar un archivo ya cargado (pedido explícito del usuario: "por si se
// equivocó el usuario", sin necesidad de reemplazarlo de inmediato por otro)
// — mismas validaciones de pertenencia que subirArchivoPara*, delega el
// desvincular + retirar (estado='retirado' + auditoría) en el repository.
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

// Descarga autenticada (laboratorio.controller.js#descargarArchivo) —
// nunca por static serving directo, ver comentario del .gitignore.
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
  eliminar,
};
