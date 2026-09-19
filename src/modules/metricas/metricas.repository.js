const db = require('../../config/database');

const TOP_N = 10;

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

function baseQuery({ desde, hasta }) {
  return db('registros_laboratorio as r')
    .where('r.eliminado', false)
    .andWhere('r.fecha_solicitud', '>=', desde)
    .andWhere('r.fecha_solicitud', '<=', hasta);
}

async function contarPorEstado(rango) {
  return baseQuery(rango).groupBy('r.estado').select('r.estado').count({ total: 'r.id' });
}

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

async function contarEnviosPorCanalResultado({ desde, hasta }) {
  return db('envios_laboratorio as e')
    .join('registros_laboratorio as r', 'r.id', 'e.registro_laboratorio_id')
    .where('r.eliminado', false)
    .andWhere('e.enviado_en', '>=', desde)
    .andWhere('e.enviado_en', '<', db.raw("?::date + interval '1 day'", [hasta]))
    .groupBy('e.canal_intentado')
    .groupByRaw(RESULTADO_ENVIO)
    .select('e.canal_intentado as canal', db.raw(`${RESULTADO_ENVIO} as resultado`))
    .count({ total: 'e.id' });
}

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
