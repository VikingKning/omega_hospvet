// Única capa que habla con Knex para este módulo (documento de Arquitectura
// y Buenas Prácticas, sección 4.1 — inversión de dependencias).
const db = require('../../config/database');

// Cuántos "top N" mostrar en las gráficas de barras — catálogo real de
// laboratorio (33 categorías/~780 estudios, ver
// laboratorio_catalogo_completo) es demasiado grande para una sola gráfica
// legible; un top 10 cubre el caso de uso real (saber qué se pide MÁS) sin
// amontonar barras ilegibles.
const TOP_N = 10;

// La clínica opera en esta zona horaria. `pendiente_desde` es timestamptz,
// por lo que convertirlo antes de extraer día/hora evita que una orden de la
// tarde aparezca en una franja UTC distinta a la que vio el personal.
const RECEPCION_LOCAL = "timezone('America/Mexico_City', coalesce(r.pendiente_desde, r.creado_en))";

const ANTIGUEDAD_ABIERTA = `case
  when now() - coalesce(r.pendiente_desde, r.creado_en) < interval '1 hour' then 'menos_1h'
  when now() - coalesce(r.pendiente_desde, r.creado_en) < interval '6 hours' then '1_6h'
  when now() - coalesce(r.pendiente_desde, r.creado_en) < interval '24 hours' then '6_24h'
  when now() - coalesce(r.pendiente_desde, r.creado_en) < interval '3 days' then '1_3d'
  else 'mas_3d'
end`;

const RESULTADO_ENVIO = `case
  when e.canal_intentado = 'correo' and e.correo_exitoso is true then 'exitoso'
  when e.canal_intentado = 'whatsapp' and e.whatsapp_exitoso is true then 'exitoso'
  when e.canal_intentado = 'ambos'
    and e.correo_exitoso is true
    and e.whatsapp_exitoso is true then 'exitoso'
  else 'fallido'
end`;

// Filtro base compartido por todas las queries de este módulo: siempre
// `eliminado = false` (mismo criterio que laboratorio.repository.js) y
// siempre acotado al rango de fechas de NEGOCIO (`fecha_solicitud`, la
// fecha que el staff capturó al crear la orden — no `creado_en`, que solo
// refleja cuándo se guardó el registro en el sistema).
function baseQuery({ desde, hasta }) {
  return db('registros_laboratorio as r')
    .where('r.eliminado', false)
    .andWhere('r.fecha_solicitud', '>=', desde)
    .andWhere('r.fecha_solicitud', '<=', hasta);
}

async function contarPorEstado(rango) {
  return baseQuery(rango).groupBy('r.estado').select('r.estado').count({ total: 'r.id' });
}

// Un punto por día calendario dentro del rango (el propio front decide si
// mostrarlo como línea/barras) — días sin ninguna orden simplemente no
// aparecen en el resultado; se rellenan con 0 del lado de metricas.service.js
// para que la gráfica no salte fechas.
async function contarPorDia(rango) {
  return baseQuery(rango)
    .groupBy('r.fecha_solicitud')
    .orderBy('r.fecha_solicitud')
    .select('r.fecha_solicitud as fecha')
    .count({ total: 'r.id' });
}

async function topEstudios(rango) {
  return baseQuery(rango)
    .join('estudios_solicitados as es', 'es.registro_laboratorio_id', 'r.id')
    .join('catalogo_estudios as ce', 'ce.id', 'es.estudio_id')
    .groupBy('ce.id', 'ce.nombre')
    .select('ce.nombre')
    .count({ total: 'es.id' })
    .orderBy('total', 'desc')
    .limit(TOP_N);
}

async function topCategorias(rango) {
  return baseQuery(rango)
    .join('estudios_solicitados as es', 'es.registro_laboratorio_id', 'r.id')
    .join('catalogo_estudios as ce', 'ce.id', 'es.estudio_id')
    .join('catalogo_categorias_estudio as cc', 'cc.id', 'ce.categoria_id')
    .groupBy('cc.id', 'cc.nombre')
    .select('cc.nombre')
    .count({ total: 'es.id' })
    .orderBy('total', 'desc')
    .limit(TOP_N);
}

// `doctor_id` es nullable (registros_laboratorio.doctor_id, ver migración
// create_registros_laboratorio) — un leftJoin deja esas filas con
// `nombre`/`apellidos` en NULL en vez de perderlas del conteo;
// metricas.service.js las agrupa como "Sin doctor asignado".
async function topDoctores(rango) {
  return baseQuery(rango)
    .leftJoin('doctores as d', 'd.id', 'r.doctor_id')
    .groupBy('r.doctor_id', 'd.nombre', 'd.apellidos')
    .select('d.nombre', 'd.apellidos')
    .count({ total: 'r.id' })
    .orderBy('total', 'desc')
    .limit(TOP_N);
}

async function contarRecepcionPorDiaHora(rango) {
  return baseQuery(rango)
    .groupByRaw(`extract(isodow from ${RECEPCION_LOCAL})`)
    .groupByRaw(`extract(hour from ${RECEPCION_LOCAL})`)
    .orderByRaw(`extract(isodow from ${RECEPCION_LOCAL})`)
    .orderByRaw(`extract(hour from ${RECEPCION_LOCAL})`)
    .select(
      db.raw(`extract(isodow from ${RECEPCION_LOCAL})::int as dia_semana`),
      db.raw(`extract(hour from ${RECEPCION_LOCAL})::int as hora`),
    )
    .count({ total: 'r.id' });
}

async function contarPorEspecie(rango) {
  return baseQuery(rango)
    .join('mascotas as m', 'm.id', 'r.mascota_id')
    .whereRaw("lower(trim(m.tipo)) in ('perro', 'gato')")
    .groupByRaw('lower(trim(m.tipo))')
    .select(db.raw('lower(trim(m.tipo)) as especie'))
    .count({ total: 'r.id' });
}

async function contarAntiguedadAbiertas(rango) {
  return baseQuery(rango)
    .whereIn('r.estado', ['pendiente', 'cargado'])
    .groupBy('r.estado')
    .groupByRaw(ANTIGUEDAD_ABIERTA)
    .select('r.estado', db.raw(`${ANTIGUEDAD_ABIERTA} as rango`))
    .count({ total: 'r.id' });
}

async function contarEnviosPorCanalResultado(rango) {
  return baseQuery(rango)
    .join('envios_laboratorio as e', 'e.registro_laboratorio_id', 'r.id')
    .groupBy('e.canal_intentado')
    .groupByRaw(RESULTADO_ENVIO)
    .select('e.canal_intentado as canal', db.raw(`${RESULTADO_ENVIO} as resultado`))
    .count({ total: 'e.id' });
}

// Promedios en horas de cada transición del flujo (pendiente -> cargado ->
// enviado). Cada promedio se calcula SOLO sobre las filas que de verdad ya
// pasaron por esa transición (`cargado_en`/`enviado_en` no nulos) — una
// orden que sigue pendiente no cuenta como "0 horas", contarla así sesgaría
// el promedio hacia abajo en vez de simplemente no tener dato todavía.
async function tiemposPromedio(rango) {
  const row = await baseQuery(rango)
    .select(
      db.raw(
        `avg(extract(epoch from (cargado_en - pendiente_desde)) / 3600) filter (where cargado_en is not null) as horas_pendiente_a_cargado`,
      ),
      db.raw(
        `avg(extract(epoch from (enviado_en - cargado_en)) / 3600) filter (where enviado_en is not null and cargado_en is not null) as horas_cargado_a_enviado`,
      ),
      db.raw(
        `avg(extract(epoch from (enviado_en - pendiente_desde)) / 3600) filter (where enviado_en is not null) as horas_pendiente_a_enviado`,
      ),
    )
    .first();
  return {
    horasPendienteACargado: row?.horas_pendiente_a_cargado ?? null,
    horasCargadoAEnviado: row?.horas_cargado_a_enviado ?? null,
    horasPendienteAEnviado: row?.horas_pendiente_a_enviado ?? null,
  };
}

module.exports = {
  contarPorEstado,
  contarPorDia,
  topEstudios,
  topCategorias,
  topDoctores,
  contarRecepcionPorDiaHora,
  contarPorEspecie,
  contarAntiguedadAbiertas,
  contarEnviosPorCanalResultado,
  tiemposPromedio,
};
