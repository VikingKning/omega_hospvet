const repository = require('./metricas-whatsapp.repository');

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS_VALIDOS = [7, 30, 90];
const AGRUPACIONES_VALIDAS = ['dia', 'semana', 'mes'];
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const ERRORES = [
  { clave: 'plantilla', etiqueta: 'Plantilla inexistente' },
  { clave: 'autenticacion', etiqueta: 'Error de autenticación' },
  { clave: 'telefono', etiqueta: 'Teléfono inválido' },
  { clave: 'media', etiqueta: 'Fallo de media' },
  { clave: 'api', etiqueta: 'Error de API' },
  { clave: 'otros', etiqueta: 'Otros' },
];

function formatoFecha(date) {
  return date.toISOString().slice(0, 10);
}

function restarDias(fecha, dias) {
  return formatoFecha(new Date(fecha.getTime() - dias * 86400000));
}

function normalizarRango({ desde: rawDesde, hasta: rawHasta, preset: rawPreset }) {
  const hoy = new Date();
  const preset = PRESETS_VALIDOS.includes(Number(rawPreset)) ? Number(rawPreset) : null;
  if (preset) return { desde: restarDias(hoy, preset - 1), hasta: formatoFecha(hoy) };
  const desde = FECHA_REGEX.test(rawDesde) ? rawDesde : restarDias(hoy, 29);
  const hasta = FECHA_REGEX.test(rawHasta) ? rawHasta : formatoFecha(hoy);
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

function diasEnRango(rango) {
  return (
    Math.floor(
      (new Date(`${rango.hasta}T00:00:00Z`) - new Date(`${rango.desde}T00:00:00Z`)) / 86400000,
    ) + 1
  );
}

function resolverAgrupacion(valor, rango) {
  if (AGRUPACIONES_VALIDAS.includes(valor)) return valor;
  const dias = diasEnRango(rango);
  if (dias <= 31) return 'dia';
  if (dias <= 120) return 'semana';
  return 'mes';
}

function inicioPeriodo(fecha, agrupacion) {
  const date = new Date(`${fecha}T00:00:00Z`);
  if (agrupacion === 'semana') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() || 7) - 1));
  } else if (agrupacion === 'mes') {
    date.setUTCDate(1);
  }
  return date;
}

function avanzarPeriodo(date, agrupacion) {
  if (agrupacion === 'dia') date.setUTCDate(date.getUTCDate() + 1);
  if (agrupacion === 'semana') date.setUTCDate(date.getUTCDate() + 7);
  if (agrupacion === 'mes') date.setUTCMonth(date.getUTCMonth() + 1);
}

function etiquetaPeriodo(fecha, agrupacion) {
  if (agrupacion === 'dia') return fecha;
  const [, mes, dia] = fecha.split('-');
  if (agrupacion === 'semana') return `Semana ${dia}/${mes}`;
  return fecha.slice(0, 7);
}

function normalizarPeriodos(rango, agrupacion, filas) {
  const datos = new Map(
    filas.map((fila) => [
      formatoFecha(new Date(fila.periodo)),
      { total: Number(fila.total), exitosos: Number(fila.exitosos) },
    ]),
  );
  const cursor = inicioPeriodo(rango.desde, agrupacion);
  const fin = inicioPeriodo(rango.hasta, agrupacion);
  const resultado = [];
  while (cursor <= fin) {
    const periodo = formatoFecha(cursor);
    const valores = datos.get(periodo) ?? { total: 0, exitosos: 0 };
    resultado.push({
      periodo,
      etiqueta: etiquetaPeriodo(periodo, agrupacion),
      ...valores,
      tasaExito: valores.total ? Math.round((valores.exitosos / valores.total) * 1000) / 10 : 0,
    });
    avanzarPeriodo(cursor, agrupacion);
  }
  return resultado;
}

function clasificarError({ error_codigo: codigo, error_mensaje: mensaje }) {
  const texto = `${codigo ?? ''} ${mensaje ?? ''}`.toLowerCase();
  if (/131030|tel[eé]fono|phone|recipient|destinatario|n[uú]mero inv[aá]lido/.test(texto))
    return 'telefono';
  if (/190|autentic|oauth|access.?token|token de acceso|permiso/.test(texto))
    return 'autenticacion';
  if (/1320|plantilla|template|aprobada|approved/.test(texto)) return 'plantilla';
  if (/131053|media|archivo|documento|imagen|video|upload|subir/.test(texto)) return 'media';
  if (/api|graph|meta|http|rate|l[ií]mit|servicio|temporar/.test(texto)) return 'api';
  return 'otros';
}

function categoriaPlantilla(nombre) {
  const valor = nombre.toLowerCase();
  if (/resultado.*laboratorio|laboratorio.*resultado/.test(valor))
    return 'Resultados de laboratorio';
  if (/recordatorio/.test(valor)) return 'Recordatorios';
  if (/cambio.*horario|horario.*cambio/.test(valor)) return 'Cambios de horario';
  return 'Otras plantillas';
}

function nombreLegible(valor) {
  return valor || 'Sin plantilla';
}

async function obtenerMetricasWhatsapp(filtros = {}) {
  const rango = normalizarRango(filtros);
  const agrupacion = resolverAgrupacion(filtros.agrupacion, rango);
  const [resumenRaw, periodosRaw, plantillasRaw, erroresRaw, diaHoraRaw, fallosPlantillaRaw] =
    await Promise.all([
      repository.obtenerResumen(rango),
      repository.contarPorPeriodo(rango, agrupacion),
      repository.contarPorPlantilla(rango),
      repository.listarErrores(rango),
      repository.contarPorDiaHora(rango),
      repository.topPlantillasConFallos(rango),
    ]);

  const total = Number(resumenRaw?.total ?? 0);
  const exitosos = Number(resumenRaw?.exitosos ?? 0);
  const fallidos = Number(resumenRaw?.fallidos ?? 0);
  const plantillas = plantillasRaw.map((fila) => ({
    nombre: nombreLegible(fila.plantilla),
    total: Number(fila.total),
  }));

  const erroresTotales = new Map(ERRORES.map(({ clave }) => [clave, 0]));
  erroresRaw.forEach((fila) => {
    const clave = clasificarError(fila);
    erroresTotales.set(clave, erroresTotales.get(clave) + Number(fila.total));
  });
  const errores = ERRORES.map(({ clave, etiqueta }) => ({
    clave,
    etiqueta,
    total: erroresTotales.get(clave),
  }));
  const errorFrecuente = errores.reduce(
    (mayor, fila) => (fila.total > mayor.total ? fila : mayor),
    { etiqueta: '—', total: 0 },
  );

  const categorias = new Map([
    ['Resultados de laboratorio', 0],
    ['Recordatorios', 0],
    ['Cambios de horario', 0],
    ['Otras plantillas', 0],
  ]);
  plantillas.forEach((fila) => {
    const categoria = categoriaPlantilla(fila.nombre);
    categorias.set(categoria, categorias.get(categoria) + fila.total);
  });

  const celdas = new Map(
    diaHoraRaw.map((fila) => [
      `${Number(fila.dia_semana)}:${Number(fila.hora)}`,
      { total: Number(fila.total), fallidos: Number(fila.fallidos) },
    ]),
  );
  const mapaCalor = DIAS_SEMANA.map((etiqueta, indice) => ({
    etiqueta,
    enviados: Array.from(
      { length: 24 },
      (_, hora) => celdas.get(`${indice + 1}:${hora}`)?.total ?? 0,
    ),
    errores: Array.from(
      { length: 24 },
      (_, hora) => celdas.get(`${indice + 1}:${hora}`)?.fallidos ?? 0,
    ),
  }));
  const porDiaSemana = mapaCalor.map((dia) => ({
    etiqueta: dia.etiqueta,
    total: dia.enviados.reduce((suma, valor) => suma + valor, 0),
  }));
  const porHora = Array.from({ length: 24 }, (_, hora) => ({
    etiqueta: `${String(hora).padStart(2, '0')}:00`,
    total: mapaCalor.reduce((suma, dia) => suma + dia.enviados[hora], 0),
  }));

  return {
    rango,
    agrupacion,
    total,
    exitosos,
    fallidos,
    tasaExito: total ? Math.round((exitosos / total) * 1000) / 10 : 0,
    promedioDiario: Math.round((total / diasEnRango(rango)) * 10) / 10,
    plantillaMasUtilizada: plantillas[0]?.nombre ?? '—',
    usosPlantillaMasUtilizada: plantillas[0]?.total ?? 0,
    errorMasFrecuente: errorFrecuente.total ? errorFrecuente.etiqueta : '—',
    ocurrenciasErrorMasFrecuente: errorFrecuente.total,
    tendencia: normalizarPeriodos(rango, agrupacion, periodosRaw),
    resultadoEnvios: [
      { etiqueta: 'Exitosos', total: exitosos },
      { etiqueta: 'Fallidos', total: fallidos },
    ],
    mensajesPorPlantilla: [...categorias].map(([nombre, valor]) => ({ nombre, total: valor })),
    erroresFrecuentes: errores,
    porDiaSemana,
    porHora,
    plantillasConFallos: fallosPlantillaRaw.map((fila) => ({
      nombre: nombreLegible(fila.plantilla),
      total: Number(fila.total),
    })),
    mapaCalor,
  };
}

module.exports = { obtenerMetricasWhatsapp };
