// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias).
const db = require('../../config/database');

const SORT_COLUMNS = {
  fecha: 'r.fecha_solicitud',
  mascota: 'm.nombre',
  estado: 'r.estado',
};

// "Nuevo registro": catálogo completo (33 categorías, ~600 estudios) para
// la isla JSON que arma el combobox de categoría/estudio con búsqueda en
// cliente — mismo criterio que #agendaDoctoresData (catálogo chico, se
// embebe entero, no hace falta ida y vuelta al servidor por cada tecleo).
async function findCatalogo() {
  const [categorias, estudios] = await Promise.all([
    db('catalogo_categorias_estudio')
      .where('activo', true)
      .orderBy('nombre')
      .select('id', 'nombre'),
    db('catalogo_estudios')
      .where('activo', true)
      .orderBy('nombre')
      .select('id', 'categoria_id', 'codigo', 'nombre', 'campo_adicional', 'especie'),
  ]);
  return categorias.map((categoria) => ({
    id: categoria.id,
    nombre: categoria.nombre,
    estudios: estudios
      .filter((estudio) => estudio.categoria_id === categoria.id)
      .map((estudio) => ({
        id: estudio.id,
        codigo: estudio.codigo,
        nombre: estudio.nombre,
        campoAdicional: estudio.campo_adicional,
        especie: estudio.especie,
      })),
  }));
}

async function findZonasAnatomicas() {
  return db('catalogo_zonas_anatomicas').orderBy('nombre').select('id', 'codigo', 'nombre');
}

// Filtro "Tipo de estudio" del toolbar — catálogo chico (33 filas), sin los
// ~600 estudios de findCatalogo() que ese <select> no necesita.
async function findCategorias() {
  return db('catalogo_categorias_estudio')
    .where('activo', true)
    .orderBy('nombre')
    .select('id', 'nombre');
}

// laboratorio.service.js#validarEstudios: nunca se confía en que el
// `campoAdicional`/`activo` que mandó el cliente coincida con el catálogo
// real — se resuelve aquí por id antes de aceptar el alta (mismo criterio
// que cualquier id que llega del cliente en el resto del sistema).
async function findEstudiosByIds(ids) {
  if (!ids.length) return [];
  return db('catalogo_estudios')
    .whereIn('id', ids)
    .select('id', 'nombre', 'campo_adicional', 'activo');
}

async function findZonaById(id) {
  return db('catalogo_zonas_anatomicas').where({ id }).first('id');
}

function baseQuery({ q, estado, categoriaId }) {
  return db('registros_laboratorio as r')
    .where('r.eliminado', false)
    .join('mascotas as m', 'm.id', 'r.mascota_id')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .leftJoin('doctores as d', 'd.id', 'r.doctor_id')
    .modify((builder) => {
      if (q) {
        builder.andWhere((whereBuilder) => {
          whereBuilder
            .whereRaw('m.nombre ILIKE ?', [`%${q}%`])
            .orWhereRaw("(p.nombre || ' ' || p.apellidos) ILIKE ?", [`%${q}%`])
            .orWhereRaw("(d.nombre || ' ' || d.apellidos) ILIKE ?", [`%${q}%`]);
        });
      }
      if (estado) builder.andWhere('r.estado', estado);
      if (categoriaId) {
        builder.whereExists(
          db('estudios_solicitados as es')
            .join('catalogo_estudios as ce', 'ce.id', 'es.estudio_id')
            .whereRaw('es.registro_laboratorio_id = r.id')
            .andWhere('ce.categoria_id', categoriaId),
        );
      }
    });
}

async function count(filters) {
  const row = await baseQuery(filters).count({ total: 'r.id' }).first();
  return Number(row.total);
}

async function findPage({ q, estado, categoriaId, sort, dir, limit, offset }) {
  return baseQuery({ q, estado, categoriaId })
    .orderBy(SORT_COLUMNS[sort] ?? SORT_COLUMNS.fecha, dir)
    .limit(limit)
    .offset(offset)
    .select(
      'r.id',
      'r.estado',
      'r.fecha_solicitud',
      'r.cargado_en',
      'r.enviado_en',
      'm.nombre as mascota_nombre',
      'm.tipo as mascota_tipo',
      'p.nombre as propietario_nombre',
      'p.apellidos as propietario_apellidos',
      'd.nombre as doctor_nombre',
      'd.apellidos as doctor_apellidos',
    );
}

// Independiente de filtros: distingue "el catálogo nunca ha tenido un
// registro" (estado vacío con CTA) de "esta búsqueda no encontró nada"
// (mismo criterio que existsAny() en doctores/áreas).
async function existsAny() {
  const row = await db('registros_laboratorio')
    .where('eliminado', false)
    .first(db.raw('true as exists'))
    .limit(1);
  return Boolean(row);
}

// Estudios de una página de registros ya resuelta — separado de la consulta
// principal para no repetir un JOIN + agregación en cada fila (mismo
// criterio que tutores.repository.js#mascotasPorPropietarios).
async function estudiosPorRegistros(registroIds) {
  if (!registroIds.length) return [];
  return db('estudios_solicitados as es')
    .whereIn('es.registro_laboratorio_id', registroIds)
    .join('catalogo_estudios as ce', 'ce.id', 'es.estudio_id')
    .orderBy('ce.nombre')
    .select('es.registro_laboratorio_id', 'ce.nombre');
}

function filaEstudio(estudio, registroId) {
  return {
    registro_laboratorio_id: registroId,
    estudio_id: estudio.estudioId,
    zona_anatomica_id: estudio.zonaAnatomicaId ?? null,
    tipo_muestra: estudio.tipoMuestra ?? null,
    antibiograma: estudio.antibiograma ?? null,
    tejido_origen: estudio.tejidoOrigen ?? null,
    lateralidad: estudio.lateralidad ?? null,
    componentes_liquido: estudio.componentesLiquido ?? null,
    observaciones: estudio.observaciones ?? null,
    estado: 'pendiente',
    creado_en: new Date(),
  };
}

// Alta: la orden y todos sus estudios en una sola transacción — si el
// insert de algún estudio fallara, la orden tampoco debe quedar creada a
// medias (mismo criterio que doctores.repository.js#crear con doctor_area).
// `fechaSolicitud`/`observaciones` (generales) son captura real del
// formulario (pedido explícito del usuario, mockup de pantalla completa) —
// ya no se fijan solas en el servidor.
async function crearRegistro({
  mascotaId,
  doctorId,
  fechaSolicitud,
  observaciones,
  usuarioId,
  estudios,
}) {
  return db.transaction(async (trx) => {
    const [row] = await trx('registros_laboratorio')
      .insert({
        mascota_id: mascotaId,
        doctor_id: doctorId,
        fecha_solicitud: fechaSolicitud,
        observaciones: observaciones ?? null,
        estado: 'pendiente',
        pendiente_desde: trx.fn.now(),
        creado_por: usuarioId,
        creado_en: trx.fn.now(),
      })
      .returning('id');
    const registroId = row.id;

    await trx('estudios_solicitados').insert(
      estudios.map((estudio) => filaEstudio(estudio, registroId)),
    );

    return registroId;
  });
}

// Detalle completo de UNA orden, para precargar la pantalla de edición/
// consulta (mismo espíritu que tutores.service.js#obtenerParaEditar) — trae
// también los datos del tutor/mascota (de solo lectura en esa pantalla, ver
// mockup) aunque no se vayan a modificar aquí, para no depender de una
// segunda consulta desde el service.
async function findById(id) {
  const registro = await db('registros_laboratorio as r')
    .join('mascotas as m', 'm.id', 'r.mascota_id')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .where('r.id', id)
    .andWhere('r.eliminado', false)
    .first(
      'r.id',
      'r.mascota_id',
      'r.doctor_id',
      'r.fecha_solicitud',
      'r.estado',
      'r.observaciones',
      'm.nombre as mascota_nombre',
      'm.tipo as mascota_tipo',
      'm.sexo as mascota_sexo',
      'm.anio_nacimiento as mascota_anio_nacimiento',
      'm.raza as mascota_raza',
      'p.id as propietario_id',
      'p.nombre as propietario_nombre',
      'p.apellidos as propietario_apellidos',
      'p.telefono as propietario_telefono',
      'p.correo as propietario_correo',
    );
  if (!registro) return undefined;

  // LEFT JOIN a archivos_laboratorio (pedido explícito del usuario: mostrar
  // en "Ver" el archivo ya cargado de cada estudio, si tiene) — antes este
  // SELECT ni siquiera traía `archivo_id`.
  const estudios = await db('estudios_solicitados as es')
    .leftJoin('archivos_laboratorio as a', 'a.id', 'es.archivo_id')
    .where('es.registro_laboratorio_id', id)
    .orderBy('es.id')
    .select(
      'es.id',
      'es.estudio_id',
      'es.zona_anatomica_id',
      'es.tipo_muestra',
      'es.antibiograma',
      'es.tejido_origen',
      'es.lateralidad',
      'es.componentes_liquido',
      'es.observaciones',
      'es.archivo_id',
      'a.nombre_original as archivo_nombre',
      'a.cargado_en as archivo_cargado_en',
    );

  return { ...registro, estudios };
}

// Carga de archivos de resultados (pedido explícito del usuario) — vive
// aquí (no en laboratorio.archivos.js, que solo habla con disco/pdf-lib)
// porque son las únicas funciones que tocan `archivos_laboratorio`/
// `estudios_solicitados.archivo_id` en la base de datos.
async function crearArchivo({ registroId, nombreOriginal, rutaAlmacenamiento, hashContenido, tamanoBytes, consolidado, usuarioId }) {
  const [row] = await db('archivos_laboratorio')
    .insert({
      registro_laboratorio_id: registroId,
      nombre_original: nombreOriginal,
      ruta_almacenamiento: rutaAlmacenamiento,
      hash_contenido: hashContenido,
      tamano_bytes: tamanoBytes,
      consolidado,
      cargado_por: usuarioId,
      cargado_en: db.fn.now(),
    })
    .returning('id');
  return row.id;
}

async function findArchivoById(id) {
  return db('archivos_laboratorio').where({ id }).first();
}

async function asignarArchivoAEstudio(estudioId, archivoId) {
  await db('estudios_solicitados').where({ id: estudioId }).update({ archivo_id: archivoId, estado: 'cargado' });
}

// "Un archivo para todos" (pedido explícito del usuario) — pisa cualquier
// archivo individual que ya tuviera cada estudio: representa el reporte
// combinado del laboratorio, que reemplaza a los parciales.
async function asignarArchivoATodosLosEstudios(registroId, archivoId) {
  await db('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .update({ archivo_id: archivoId, estado: 'cargado' });
}

// Después de cualquier carga, si YA todos los estudios de la orden tienen
// archivo, el registro completo pasa a 'cargado' (idempotente: si ya
// estaba, no reescribe cargado_en).
async function marcarCargadoSiCompleto(registroId) {
  const pendientes = await db('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .whereNull('archivo_id')
    .first(db.raw('true as existe'));
  if (pendientes) return;

  await db('registros_laboratorio')
    .where({ id: registroId })
    .andWhere('estado', 'pendiente')
    .update({ estado: 'cargado', cargado_en: db.fn.now() });
}

// Quitar un archivo ya cargado (pedido explícito del usuario: "por si se
// equivocó el usuario") — nunca borra la fila de `archivos_laboratorio`
// (esta tabla no tiene baja lógica, se queda huérfana pero recuperable,
// mismo criterio que "Reemplazar"), solo desvincula. Reversa exacta de
// asignarArchivoATodosLosEstudios + marcarCargadoSiCompleto: al quitar el
// compartido, TODOS los estudios se sabe con certeza que se quedan sin
// archivo, así que el registro puede fijarse directo a 'pendiente'.
//
// Reutilizada tal cual para "Quitar todos los archivos" (botón a nivel de
// "Estudios solicitados", pedido explícito del usuario) — limpiar
// archivo_id en TODOS los estudios de la orden es lo mismo sin importar si
// venían de un archivo compartido o de uno distinto por estudio.
async function desasignarArchivoDeTodosLosEstudios(registroId) {
  await db('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .update({ archivo_id: null, estado: 'pendiente' });
  await db('registros_laboratorio').where({ id: registroId }).update({ estado: 'pendiente', cargado_en: null });
}

async function desasignarArchivoDeEstudio(estudioId) {
  await db('estudios_solicitados').where({ id: estudioId }).update({ archivo_id: null, estado: 'pendiente' });
}

// Reversa de marcarCargadoSiCompleto — a diferencia de "quitar de todos",
// aquí no se sabe de antemano si los DEMÁS estudios siguen teniendo archivo
// (carga individual), así que hay que volver a consultar antes de decidir
// si el registro deja de estar 'cargado'.
async function revertirCargadoSiIncompleto(registroId) {
  const pendientes = await db('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .whereNull('archivo_id')
    .first(db.raw('true as existe'));
  if (!pendientes) return;

  await db('registros_laboratorio')
    .where({ id: registroId })
    .andWhere('estado', 'cargado')
    .update({ estado: 'pendiente', cargado_en: null });
}

// Edición: reemplaza los estudios por completo (delete + insert dentro de
// la misma transacción) en vez de mergear por id como
// tutores.repository.js#editar — a diferencia de una mascota (persiste a
// través de muchos registros de laboratorio), un estudio_solicitado nace y
// vive solo dentro de UN registro, sin historial propio que preservar
// (archivo_id todavía no se usa en esta iteración), así que "reemplazar
// todo" es más simple y sigue siendo correcto.
async function actualizarRegistro(
  id,
  { mascotaId, doctorId, fechaSolicitud, observaciones, usuarioId, estudios },
) {
  await db.transaction(async (trx) => {
    await trx('registros_laboratorio')
      .where({ id })
      .update({
        mascota_id: mascotaId,
        doctor_id: doctorId,
        fecha_solicitud: fechaSolicitud,
        observaciones: observaciones ?? null,
        actualizado_por: usuarioId,
        actualizado_en: trx.fn.now(),
      });

    await trx('estudios_solicitados').where('registro_laboratorio_id', id).del();
    await trx('estudios_solicitados').insert(estudios.map((estudio) => filaEstudio(estudio, id)));
  });
}

// Baja lógica — nunca DELETE físico (mismo patrón que todo el resto del
// sistema). Idempotente (mismo criterio que US-603): un id inexistente o ya
// eliminado no truena, simplemente no afecta ninguna fila.
async function eliminar(id, usuarioId) {
  await db('registros_laboratorio').where({ id }).andWhere('eliminado', false).update({
    eliminado: true,
    eliminado_por: usuarioId,
    eliminado_en: db.fn.now(),
  });
}

module.exports = {
  findCatalogo,
  findZonasAnatomicas,
  findCategorias,
  findEstudiosByIds,
  findZonaById,
  count,
  findPage,
  existsAny,
  estudiosPorRegistros,
  crearRegistro,
  findById,
  actualizarRegistro,
  eliminar,
  crearArchivo,
  findArchivoById,
  asignarArchivoAEstudio,
  asignarArchivoATodosLosEstudios,
  marcarCargadoSiCompleto,
  desasignarArchivoDeTodosLosEstudios,
  desasignarArchivoDeEstudio,
  revertirCargadoSiIncompleto,
};
