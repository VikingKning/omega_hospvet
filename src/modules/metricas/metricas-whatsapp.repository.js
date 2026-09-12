const db = require('../../config/database');

const ENVIO_LOCAL = "timezone('America/Mexico_City', ew.enviado_en)";
const AGRUPACIONES = {
  dia: `date_trunc('day', ${ENVIO_LOCAL})`,
  semana: `date_trunc('week', ${ENVIO_LOCAL})`,
  mes: `date_trunc('month', ${ENVIO_LOCAL})`,
};

function baseQuery({ desde, hasta }) {
  return db('envios_whatsapp as ew')
    .whereRaw(`${ENVIO_LOCAL}::date >= ?`, [desde])
    .andWhereRaw(`${ENVIO_LOCAL}::date <= ?`, [hasta]);
}

async function obtenerResumen(rango) {
  return baseQuery(rango)
    .first()
    .count({ total: 'ew.id' })
    .select(
      db.raw('count(*) filter (where ew.exitoso is true) as exitosos'),
      db.raw('count(*) filter (where ew.exitoso is false) as fallidos'),
    );
}

async function contarPorPeriodo(rango, agrupacion) {
  const periodo = AGRUPACIONES[agrupacion] ?? AGRUPACIONES.dia;
  return baseQuery(rango)
    .groupByRaw(periodo)
    .orderByRaw(periodo)
    .select(db.raw(`${periodo}::date as periodo`))
    .count({ total: 'ew.id' })
    .select(db.raw('count(*) filter (where ew.exitoso is true) as exitosos'));
}

async function contarPorPlantilla(rango) {
  return baseQuery(rango)
    .groupBy('ew.plantilla')
    .select('ew.plantilla')
    .count({ total: 'ew.id' })
    .orderBy('total', 'desc');
}

async function listarErrores(rango) {
  return baseQuery(rango)
    .where('ew.exitoso', false)
    .groupBy('ew.error_codigo', 'ew.error_mensaje')
    .select('ew.error_codigo', 'ew.error_mensaje')
    .count({ total: 'ew.id' });
}

async function contarPorDiaHora(rango) {
  return baseQuery(rango)
    .groupByRaw(`extract(isodow from ${ENVIO_LOCAL})`)
    .groupByRaw(`extract(hour from ${ENVIO_LOCAL})`)
    .select(
      db.raw(`extract(isodow from ${ENVIO_LOCAL})::int as dia_semana`),
      db.raw(`extract(hour from ${ENVIO_LOCAL})::int as hora`),
    )
    .count({ total: 'ew.id' })
    .select(db.raw('count(*) filter (where ew.exitoso is false) as fallidos'));
}

async function topPlantillasConFallos(rango) {
  return baseQuery(rango)
    .groupBy('ew.plantilla')
    .select('ew.plantilla')
    .select(db.raw('count(*) filter (where ew.exitoso is false) as total'))
    .orderBy('total', 'desc')
    .limit(10);
}

module.exports = {
  obtenerResumen,
  contarPorPeriodo,
  contarPorPlantilla,
  listarErrores,
  contarPorDiaHora,
  topPlantillasConFallos,
};
