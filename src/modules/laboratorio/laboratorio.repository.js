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

// `registros_laboratorio.id` es un `serial`/integer de Postgres (int4) — un
// número fuera de ese rango (ej. un teléfono de 10 dígitos tecleado en el
// buscador) revienta la consulta con "fuera de rango para el tipo integer"
// en vez de simplemente no encontrar nada. Nunca se llega a mandar un valor
// así a `r.id = ?`.
const PG_INTEGER_MAX = 2147483647;

// Pedido explícito del usuario: el cuadro de búsqueda también acepta el
// folio del registro en cualquiera de sus formas ("LAB-005", "005", "5") —
// el mismo folio que ya muestra la UI (ver `LAB-${id.padStart(3,'0')}` en
// laboratorio-panel.ejs/laboratorio.service.js). Si `q` no calza con
// ninguna de esas formas regresa null y la búsqueda sigue siendo solo por
// nombre, sin tronar con texto libre ni con un número fuera de rango.
function extraerIdBuscado(q) {
  const match = q.trim().match(/^(?:lab-?\s*)?0*(\d+)$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id <= PG_INTEGER_MAX ? id : null;
}

// Pedido explícito del usuario: teclear el prefijo "LAB-" (o cualquier
// prefijo válido del mismo — "L", "LA", "LAB", "LAB-") debe mostrar TODOS
// los registros, como si el usuario apenas estuviera empezando a escribir
// el folio y aún no llegara al número. Solo aplica cuando `q` es
// exactamente un prefijo de la cadena "lab-" — un nombre real que también
// empiece distinto en cualquier posición (ej. "Laban", "Labib") nunca
// califica aquí y sigue resolviéndose por el ILIKE normal de abajo.
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
          // Pedido explícito del usuario: buscar también por el teléfono del
          // tutor. `propietarios.telefono` se guarda sin guiones (mismo
          // criterio que tutores.repository.js#baseQuery) — se compara
          // contra `qDigits` (los dígitos de `q`), nunca contra `q` tal
          // cual, y se omite por completo si `q` no traía ningún dígito
          // (evita un ILIKE '%%' que matchearía cualquier fila).
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

// US-409 v2: búsqueda GLOBAL por hash_contenido, filtrando SOLO archivos
// ACTIVOS (cargado/enviado) — un archivo `retirado` es histórico y nunca
// debe bloquear una carga futura (esa es justo la brecha que exponía el
// caso real: "quitar" el archivo equivocado de un registro debía liberar
// el hash para el registro correcto). Se apoya en el índice parcial
// `archivos_laboratorio_hash_activo_unique` (mismo índice que garantiza a
// nivel de BD que nunca haya 2 filas activas con el mismo hash). JOIN a
// registros_laboratorio→mascotas (paciente) y LEFT JOIN a doctores
// (solicitante) para poder armar el mensaje de conflicto sin una 2ª
// consulta — el AC pide mostrar esos datos cuando hay bloqueo. Como a lo
// más hay 1 fila activa por hash, no hace falta desambiguar duplicados.
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

// Carga de archivos de resultados (pedido explícito del usuario) — vive
// aquí (no en laboratorio.archivos.js, que solo habla con disco/pdf-lib)
// porque son las únicas funciones que tocan `archivos_laboratorio`/
// `estudios_solicitados.archivo_id` en la base de datos. Aceptan un `trx`
// opcional (default `db`) para poder componerse dentro de una transacción
// más grande (ver registrarArchivoParaTodos/registrarArchivoParaEstudio) o
// llamarse sueltas como antes.
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

// "Un archivo para todos" (pedido explícito del usuario) — pisa cualquier
// archivo individual que ya tuviera cada estudio: representa el reporte
// combinado del laboratorio, que reemplaza a los parciales.
async function asignarArchivoATodosLosEstudios(registroId, archivoId, trx = db) {
  await trx('estudios_solicitados')
    .where('registro_laboratorio_id', registroId)
    .update({ archivo_id: archivoId, estado: 'cargado' });
}

// Después de cualquier carga, si YA todos los estudios de la orden tienen
// archivo, el registro completo pasa a 'cargado' (idempotente: si ya
// estaba, no reescribe cargado_en).
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

// US-409 v2: retira un archivo (estado='retirado' + auditoría) SOLO si ya
// no queda ninguna fila de estudios_solicitados apuntándolo — defensivo,
// nunca confía en que el llamador ya desvinculó todo antes de invocarla.
// Es lo que libera un hash para poder reutilizarse en otro registro (el
// caso real: "quitar" el archivo equivocado de un registro debe permitir
// cargar el correcto en otro). Siempre dentro de la trx del llamador.
async function retirarSiNoQuedaEnUso(trx, archivoId, usuarioId) {
  const enUso = await trx('estudios_solicitados')
    .where('archivo_id', archivoId)
    .first(trx.raw('true as existe'));
  if (enUso) return;

  await trx('archivos_laboratorio')
    .where({ id: archivoId })
    .update({ estado: 'retirado', retirado_por: usuarioId, retirado_en: trx.fn.now() });
}

// Primer catch de un código de error de Postgres en el proyecto (el patrón
// establecido en el resto del código es "pre-check antes del insert",
// nunca catch-and-translate) — excepción deliberada: un pre-check por sí
// solo no puede cerrar una carrera real entre 2 transacciones concurrentes
// insertando el mismo hash activo en registros distintos (AC explícito del
// usuario); el índice único parcial + este catch sí lo garantizan.
function esViolacionHashActivo(err) {
  return err.code === '23505' && err.constraint === 'archivos_laboratorio_hash_activo_unique';
}

// US-409 v2: crea el archivo NUEVO y lo asigna, todo en una sola
// transacción — si algún paso truena (incluida la violación del índice
// único parcial por una carrera real), nada queda a medias en BD. Antes de
// asignar, toma una foto de qué archivo(s) quedaban activos para este
// registro/estudio: si la nueva asignación los desplaza y ya no los
// referencia nadie más, se retiran (cierra el hueco de "Reemplazar" que
// dejaba archivos viejos huérfanos pero eternamente 'cargado').
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

// US-409 v2: mismo flujo que arriba pero SIN crear una fila nueva — el
// contenido ya existe activo en este mismo registro (validado por
// laboratorio.service.js#resolverConflictoDeHashes), así que solo se
// reasigna. Cubre también el caso de reutilizar, dentro del mismo
// registro, un archivo que estaba activo en OTRO estudio de esa misma
// orden.
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

// Quitar un archivo ya cargado (pedido explícito del usuario: "por si se
// equivocó el usuario") — nunca borra la fila de `archivos_laboratorio`
// (esta tabla no tiene baja lógica física, se conserva como histórico,
// mismo criterio que "Reemplazar"): pasa a estado='retirado' + auditoría
// (retirado_por/retirado_en) en vez de quedar simplemente huérfana. Reversa
// exacta de asignarArchivoATodosLosEstudios + marcarCargadoSiCompleto: al
// quitar el compartido, TODOS los estudios se sabe con certeza que se
// quedan sin archivo, así que el registro puede fijarse directo a
// 'pendiente'.
//
// Reutilizada tal cual para "Quitar todos los archivos" (botón a nivel de
// "Estudios solicitados", pedido explícito del usuario) — limpiar
// archivo_id en TODOS los estudios de la orden es lo mismo sin importar si
// venían de un archivo compartido o de varios distintos por estudio (por
// eso el retiro es por cada id distinto encontrado, no uno solo).
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

// Reversa de marcarCargadoSiCompleto — a diferencia de "quitar de todos",
// aquí no se sabe de antemano si los DEMÁS estudios siguen teniendo archivo
// (carga individual), así que hay que volver a consultar antes de decidir
// si el registro deja de estar 'cargado'.
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

// Envío real de resultados (pedido explícito del usuario) — se llama UNA
// vez por intento de laboratorio.service.js#enviarResultados. Guarda qué
// canales se intentaron y el resultado individual incluso si todos fallan;
// `medio` conserva únicamente los canales que sí tuvieron éxito.
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

// US WA 007 (AC7): valida que el folio pertenezca a una orden activa
// (eliminado=false) y que ESE registro le pertenezca a una mascota cuyo
// tutor tenga exactamente ese teléfono (comparación exacta, no ILIKE — a
// diferencia de baseQuery(), que es una búsqueda difusa para el panel
// interno, aquí es un control de acceso: solo debe calificar UNA
// combinación folio+teléfono, nunca una coincidencia parcial). `trx`
// opcional (default `db`) para poder resolverse dentro de la MISMA
// transacción que registra el intento (US WA 007 AC10/AC11), igual patrón
// que crearArchivo(..., trx = db) más arriba en este archivo. No filtra
// por mascotas.activo/propietarios.activo — el AC7 no lo pide y agregar esa
// restricción bloquearía, sin que nadie lo pidiera, a un tutor legítimo
// cuyo registro haya quedado inactivo por otra razón administrativa.
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
  // US WA 007 (consideración técnica): reutilizadas por
  // whatsapp.laboratorioConsulta.js — se exportan tal cual, en vez de
  // duplicar la extracción de folio en el módulo de whatsapp.
  extraerIdBuscado,
  findByFolioYTelefono,
};
