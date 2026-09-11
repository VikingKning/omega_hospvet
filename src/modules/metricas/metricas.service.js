const repository = require('./metricas.repository');

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RANGO_DEFAULT_DIAS = 30;
const PRESETS_VALIDOS = [7, 30, 90];

const ESTADOS = ['pendiente', 'cargado', 'enviado'];
const ESTADO_LABEL = { pendiente: 'Pendiente', cargado: 'Cargado', enviado: 'Enviado' };

function formatoFecha(date) {
  return date.toISOString().slice(0, 10);
}

function restarDias(fecha, dias) {
  return formatoFecha(new Date(fecha.getTime() - dias * 24 * 60 * 60 * 1000));
}

// Pedido explícito del usuario: rango en presets (7/30/90 días, botones del
// toolbar) o fechas a mano (2 <input type="date">) — un preset, cuando
// viene, GANA sobre cualquier desde/hasta que haya llegado junto (los
// botones de preset no limpian esos inputs del lado del cliente, así que el
// servidor decide la prioridad, no el HTML). Sin preset y con desde/hasta
// ausentes o con formato inválido, cae al default (últimos 30 días,
// incluyendo hoy) — mismo criterio de "sanear con defaults en vez de
// rechazar con error" que list() en laboratorio.service.js/doctores.service.js.
function normalizarRango({ desde: rawDesde, hasta: rawHasta, preset: rawPreset }) {
  const hoy = new Date();
  const preset = PRESETS_VALIDOS.includes(Number(rawPreset)) ? Number(rawPreset) : null;
  if (preset) {
    return { desde: restarDias(hoy, preset - 1), hasta: formatoFecha(hoy) };
  }

  const defaultHasta = formatoFecha(hoy);
  const defaultDesde = restarDias(hoy, RANGO_DEFAULT_DIAS - 1);

  const desde = FECHA_REGEX.test(rawDesde) ? rawDesde : defaultDesde;
  const hasta = FECHA_REGEX.test(rawHasta) ? rawHasta : defaultHasta;

  // Un rango invertido (desde > hasta, ej. tecleado a mano) se corrige
  // intercambiando los extremos en vez de devolver una tabla vacía sin
  // explicación — mismo espíritu "nunca truena con una entrada rara" que
  // el resto de los filtros del sistema.
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

// Relleno de días sin ninguna orden con total:0 — sin esto, una gráfica de
// tendencia "saltaría" fechas silenciosamente (ej. un fin de semana sin
// órdenes desaparecería del eje X en vez de mostrarse en 0).
function rellenarDias(rango, filas) {
  const totalesPorFecha = new Map(
    filas.map((f) => [formatoFecha(new Date(f.fecha)), Number(f.total)]),
  );
  const resultado = [];
  const cursor = new Date(`${rango.desde}T00:00:00Z`);
  const fin = new Date(`${rango.hasta}T00:00:00Z`);
  while (cursor <= fin) {
    const fecha = formatoFecha(cursor);
    resultado.push({ fecha, total: totalesPorFecha.get(fecha) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return resultado;
}

function redondear(valor) {
  return valor === null ? null : Math.round(Number(valor) * 10) / 10;
}

async function obtenerMetricasLaboratorio(filtros) {
  const rango = normalizarRango(filtros);

  const [porEstadoRaw, porDiaRaw, topEstudios, topCategorias, topDoctoresRaw, tiempos] =
    await Promise.all([
      repository.contarPorEstado(rango),
      repository.contarPorDia(rango),
      repository.topEstudios(rango),
      repository.topCategorias(rango),
      repository.topDoctores(rango),
      repository.tiemposPromedio(rango),
    ]);

  const totalesPorEstado = new Map(porEstadoRaw.map((f) => [f.estado, Number(f.total)]));
  const porEstado = ESTADOS.map((estado) => ({
    estado,
    etiqueta: ESTADO_LABEL[estado],
    total: totalesPorEstado.get(estado) ?? 0,
  }));
  const total = porEstado.reduce((suma, f) => suma + f.total, 0);

  const topDoctores = topDoctoresRaw.map((fila) => ({
    // `nombre`/`apellidos` llegan NULL cuando doctor_id es NULL (leftJoin,
    // ver metricas.repository.js#topDoctores) — nunca se descarta esa
    // fila, se etiqueta explícitamente en vez de mezclarla en silencio con
    // un doctor real.
    nombre: fila.nombre ? `${fila.nombre} ${fila.apellidos}` : 'Sin doctor asignado',
    total: Number(fila.total),
  }));

  return {
    rango,
    total,
    porEstado,
    porDia: rellenarDias(rango, porDiaRaw),
    topEstudios: topEstudios.map((f) => ({ nombre: f.nombre, total: Number(f.total) })),
    topCategorias: topCategorias.map((f) => ({ nombre: f.nombre, total: Number(f.total) })),
    topDoctores,
    tiempos: {
      horasPendienteACargado: redondear(tiempos.horasPendienteACargado),
      horasCargadoAEnviado: redondear(tiempos.horasCargadoAEnviado),
      horasPendienteAEnviado: redondear(tiempos.horasPendienteAEnviado),
    },
  };
}

module.exports = { obtenerMetricasLaboratorio };
