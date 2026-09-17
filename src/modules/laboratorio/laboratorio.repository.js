const db = require('../../config/database');

const SORT_COLUMNS = {
  fecha: 'r.fecha_solicitud',
  mascota: 'm.nombre',
  estado: 'r.estado',
};

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

async function findCategorias() {
  return db('catalogo_categorias_estudio')
    .where('activo', true)
    .orderBy('nombre')
    .select('id', 'nombre');
}

async function findEstudiosByIds(ids) {
  if (!ids.length) return [];
  return db('catalogo_estudios')
    .whereIn('id', ids)
    .select('id', 'nombre', 'campo_adicional', 'activo');
}

const PG_INTEGER_MAX = 2147483647;

function extraerIdBuscado(q) {
  const match = q.trim().match(/^(?:lab-?\s*)?0*(\d+)$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id <= PG_INTEGER_MAX ? id : null;
}

function esPrefijoDeFolio(q) {
  const normalizado = q.trim().toLowerCase();
  return normalizado.length > 0 && 'lab-'.startsWith(normalizado);
}

function baseQuery({ q, qDigits, estado, categoriaId }) {
  return db('registros_laboratorio as r')
    .where('r.eliminado', false)
    .join('mascotas as m', 'm.id', 'r.mascota_id')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .leftJoin('doctores as d', 'd.id', 'r.doctor_id')
    .modify((builder) => {
      if (q) {
        const idBuscado = extraerIdBuscado(q);
        builder.andWhere((whereBuilder) => {
          whereBuilder
            .whereRaw('m.nombre ILIKE ?', [`%${q}%`])
            .orWhereRaw("(p.nombre || ' ' || p.apellidos) ILIKE ?", [`%${q}%`])
            .orWhereRaw("(d.nombre || ' ' || d.apellidos) ILIKE ?", [`%${q}%`]);
          if (qDigits) {
            whereBuilder.orWhereRaw('p.telefono ILIKE ?', [`%${qDigits}%`]);
          }
          if (idBuscado !== null) {
            whereBuilder.orWhere('r.id', idBuscado);
          }
          if (esPrefijoDeFolio(q)) {
            whereBuilder.orWhereRaw('true');
          }
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

async function findPage({ q, qDigits, estado, categoriaId, sort, dir, limit, offset }) {
  return baseQuery({ q, qDigits, estado, categoriaId })
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

async function existsAny() {
  const row = await db('registros_laboratorio')
    .where('eliminado', false)
    .first(db.raw('true as exists'))
    .limit(1);
  return Boolean(row);
}

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

async function buscarArchivosActivosPorHashes(hashes) {
  if (!hashes.length) return [];
  return db('archivos_laboratorio as a')
    .join('registros_laboratorio as r', 'r.id', 'a.registro_laboratorio_id')
    .join('mascotas as m', 'm.id', 'r.mascota_id')
    .leftJoin('doctores as d', 'd.id', 'r.doctor_id')
    .whereIn('a.hash_contenido', hashes)
    .whereIn('a.estado', ['cargado', 'enviado'])
    .select(
      'a.id',
      'a.hash_contenido',
      'a.registro_laboratorio_id',
      'm.nombre as paciente_nombre',
      'd.nombre as doctor_nombre',
      'd.apellidos as doctor_apellidos',
    );
}

async function crearArchivo(
  {
    registroId,
    nombreOriginal,
    rutaAlmacenamiento,
    hashContenido,
    tamanoBytes,
    consolidado,
    usuarioId,
  },
  trx = db,
) {
  const [row] = await trx('archivos_laboratorio')
    .insert({
      registro_laboratorio_id: registroId,
      nombre_original: nombreOriginal,
      ruta_almacenamiento: rutaAlmacenamiento,
      hash_contenido: hashContenido,
      tamano_bytes: tamanoBytes,
      consolidado,
      estado: 'cargado',
      cargado_por: usuarioId,
      cargado_en: trx.fn.now(),
    })
    .returning('id');
  return row.id;
}

async function findArchivoById(id) {
  return db('archivos_laboratorio').where({ id }).first();
}

async function asignarArchivoAEstudio(estudioId, archivoId, trx = db) {
  await trx('estudios_solicitados')
    .where({ id: estudioId })
    .update({ archivo_id: archivoId, estado: 'cargado' });
}

async function asignarArchivoATodosLosEstudios(registroId, archivoId, trx = db) {
  await trx('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .update({ archivo_id: archivoId, estado: 'cargado' });
}

async function marcarCargadoSiCompleto(registroId, trx = db) {
  const pendientes = await trx('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .whereNull('archivo_id')
    .first(trx.raw('true as existe'));
  if (pendientes) return;

  await trx('registros_laboratorio')
    .where({ id: registroId })
    .andWhere('estado', 'pendiente')
    .update({ estado: 'cargado', cargado_en: trx.fn.now() });
}

async function retirarSiNoQuedaEnUso(trx, archivoId, usuarioId) {
  const enUso = await trx('estudios_solicitados')
    .where('archivo_id', archivoId)
    .first(trx.raw('true as existe'));
  if (enUso) return;

  await trx('archivos_laboratorio')
    .where({ id: archivoId })
    .update({ estado: 'retirado', retirado_por: usuarioId, retirado_en: trx.fn.now() });
}

function esViolacionHashActivo(err) {
  return err.code === '23505' && err.constraint === 'archivos_laboratorio_hash_activo_unique';
}

async function registrarArchivoParaTodos({ registroId, metadata, usuarioId }) {
  return db.transaction(async (trx) => {
    const previos = await trx('estudios_solicitados')
      .where('registro_laboratorio_id', registroId)
      .whereNotNull('archivo_id')
      .distinct('archivo_id')
      .pluck('archivo_id');

    const archivoId = await crearArchivo({ registroId, ...metadata, usuarioId }, trx);
    await asignarArchivoATodosLosEstudios(registroId, archivoId, trx);
    await marcarCargadoSiCompleto(registroId, trx);

    for (const idPrevio of previos) {
      if (idPrevio !== archivoId) await retirarSiNoQuedaEnUso(trx, idPrevio, usuarioId);
    }
    return archivoId;
  });
}

async function registrarArchivoParaEstudio({ registroId, estudioId, metadata, usuarioId }) {
  return db.transaction(async (trx) => {
    const estudioPrevio = await trx('estudios_solicitados')
      .where({ id: estudioId })
      .first('archivo_id');

    const archivoId = await crearArchivo({ registroId, ...metadata, usuarioId }, trx);
    await asignarArchivoAEstudio(estudioId, archivoId, trx);
    await marcarCargadoSiCompleto(registroId, trx);

    if (estudioPrevio?.archivo_id && estudioPrevio.archivo_id !== archivoId) {
      await retirarSiNoQuedaEnUso(trx, estudioPrevio.archivo_id, usuarioId);
    }
    return archivoId;
  });
}

async function reutilizarArchivoParaTodos({ registroId, archivoId, usuarioId }) {
  return db.transaction(async (trx) => {
    const previos = await trx('estudios_solicitados')
      .where('registro_laboratorio_id', registroId)
      .whereNotNull('archivo_id')
      .distinct('archivo_id')
      .pluck('archivo_id');

    await asignarArchivoATodosLosEstudios(registroId, archivoId, trx);
    await marcarCargadoSiCompleto(registroId, trx);

    for (const idPrevio of previos) {
      if (idPrevio !== archivoId) await retirarSiNoQuedaEnUso(trx, idPrevio, usuarioId);
    }
  });
}

async function reutilizarArchivoParaEstudio({ registroId, estudioId, archivoId, usuarioId }) {
  return db.transaction(async (trx) => {
    const estudioPrevio = await trx('estudios_solicitados')
      .where({ id: estudioId })
      .first('archivo_id');

    await asignarArchivoAEstudio(estudioId, archivoId, trx);
    await marcarCargadoSiCompleto(registroId, trx);

    if (estudioPrevio?.archivo_id && estudioPrevio.archivo_id !== archivoId) {
      await retirarSiNoQuedaEnUso(trx, estudioPrevio.archivo_id, usuarioId);
    }
  });
}

async function desasignarArchivoDeTodosLosEstudios(registroId, usuarioId) {
  return db.transaction(async (trx) => {
    const archivoIds = await trx('estudios_solicitados')
      .where('registro_laboratorio_id', registroId)
      .whereNotNull('archivo_id')
      .distinct('archivo_id')
      .pluck('archivo_id');

    await trx('estudios_solicitados')
      .where('registro_laboratorio_id', registroId)
      .update({ archivo_id: null, estado: 'pendiente' });
    await trx('registros_laboratorio')
      .where({ id: registroId })
      .update({ estado: 'pendiente', cargado_en: null });

    for (const archivoId of archivoIds) {
      await retirarSiNoQuedaEnUso(trx, archivoId, usuarioId);
    }
  });
}

async function desasignarArchivoDeEstudio(estudioId, usuarioId) {
  return db.transaction(async (trx) => {
    const estudioPrevio = await trx('estudios_solicitados')
      .where({ id: estudioId })
      .first('archivo_id');

    await trx('estudios_solicitados')
      .where({ id: estudioId })
      .update({ archivo_id: null, estado: 'pendiente' });

    if (estudioPrevio?.archivo_id) {
      await retirarSiNoQuedaEnUso(trx, estudioPrevio.archivo_id, usuarioId);
    }
  });
}

async function revertirCargadoSiIncompleto(registroId, trx = db) {
  const pendientes = await trx('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .whereNull('archivo_id')
    .first(trx.raw('true as existe'));
  if (!pendientes) return;

  await trx('registros_laboratorio')
    .where({ id: registroId })
    .andWhere('estado', 'cargado')
    .update({ estado: 'pendiente', cargado_en: null });
}

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

async function registrarEnvio({
  registroLaboratorioId,
  canalIntentado,
  medio,
  destinatarioCorreo,
  destinatarioTelefono,
  correoExitoso,
  whatsappExitoso,
  errorCorreo,
  errorWhatsapp,
  archivoIds,
  usuarioId,
}) {
  await db.transaction(async (trx) => {
    const [envio] = await trx('envios_laboratorio')
      .insert({
        registro_laboratorio_id: registroLaboratorioId,
        canal_intentado: canalIntentado,
        medio,
        destinatario_correo: destinatarioCorreo,
        destinatario_telefono: destinatarioTelefono,
        correo_exitoso: correoExitoso,
        whatsapp_exitoso: whatsappExitoso,
        error_correo: errorCorreo,
        error_whatsapp: errorWhatsapp,
        enviado_por: usuarioId,
        enviado_en: trx.fn.now(),
      })
      .returning('id');

    await trx('envio_archivo').insert(
      archivoIds.map((archivoId) => ({ envio_id: envio.id, archivo_id: archivoId })),
    );

    if (medio) {
      await trx('archivos_laboratorio')
        .whereIn('id', archivoIds)
        .andWhere('estado', '!=', 'enviado')
        .update({ estado: 'enviado', enviado_por: usuarioId, enviado_en: trx.fn.now() });

      await trx('registros_laboratorio')
        .where({ id: registroLaboratorioId })
        .andWhere('estado', '!=', 'enviado')
        .update({ estado: 'enviado', enviado_en: trx.fn.now() });
    }
  });
}

async function eliminar(id, usuarioId) {
  await db('registros_laboratorio').where({ id }).andWhere('eliminado', false).update({
    eliminado: true,
    eliminado_por: usuarioId,
    eliminado_en: db.fn.now(),
  });
}

async function findByFolioYTelefono(folioId, telefonoDigits, trx = db) {
  return trx('registros_laboratorio as r')
    .join('mascotas as m', 'm.id', 'r.mascota_id')
    .join('propietarios as p', 'p.id', 'm.propietario_id')
    .where('r.id', folioId)
    .andWhere('r.eliminado', false)
    .andWhere('p.telefono', telefonoDigits)
    .first('r.id', 'r.estado');
}

module.exports = {
  findCatalogo,
  findZonasAnatomicas,
  findCategorias,
  findEstudiosByIds,
  count,
  findPage,
  existsAny,
  estudiosPorRegistros,
  crearRegistro,
  findById,
  actualizarRegistro,
  eliminar,
  buscarArchivosActivosPorHashes,
  findArchivoById,
  esViolacionHashActivo,
  registrarArchivoParaTodos,
  registrarArchivoParaEstudio,
  reutilizarArchivoParaTodos,
  reutilizarArchivoParaEstudio,
  desasignarArchivoDeTodosLosEstudios,
  desasignarArchivoDeEstudio,
  revertirCargadoSiIncompleto,
  registrarEnvio,
  extraerIdBuscado,
  findByFolioYTelefono,
};
