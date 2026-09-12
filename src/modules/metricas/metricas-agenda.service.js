const repository = require('./metricas-agenda.repository');

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS_VALIDOS = [7, 30, 90];
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DURACIONES = [15, 30, 45, 60, 90];
const HORA_INICIO_MAPA = 8;
const HORA_FIN_MAPA = 18;

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

  const desdeDefault = restarDias(hoy, 29);
  const hastaDefault = formatoFecha(hoy);
  const desde = FECHA_REGEX.test(rawDesde) ? rawDesde : desdeDefault;
  const hasta = FECHA_REGEX.test(rawHasta) ? rawHasta : hastaDefault;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

function rellenarDias(rango, filas) {
  const totales = new Map(
    filas.map((fila) => [formatoFecha(new Date(fila.fecha)), Number(fila.total)]),
  );
  const resultado = [];
  const cursor = new Date(`${rango.desde}T00:00:00Z`);
  const fin = new Date(`${rango.hasta}T00:00:00Z`);
  while (cursor <= fin) {
    const fecha = formatoFecha(cursor);
    resultado.push({ fecha, total: totales.get(fecha) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return resultado;
}

function normalizarMapa(filas) {
  const totales = new Map(
    filas.map((fila) => [`${Number(fila.dia_semana)}:${Number(fila.hora)}`, Number(fila.total)]),
  );
  return DIAS_SEMANA.map((etiqueta, indice) => ({
    dia: indice + 1,
    etiqueta,
    horas: Array.from(
      { length: HORA_FIN_MAPA - HORA_INICIO_MAPA + 1 },
      (_, offset) => totales.get(`${indice + 1}:${HORA_INICIO_MAPA + offset}`) ?? 0,
    ),
  }));
}

function normalizarDemandaDiaHorario(filas) {
  const totales = new Map(
    filas.map((fila) => [`${Number(fila.dia_semana)}:${Number(fila.hora)}`, Number(fila.total)]),
  );
  return DIAS_SEMANA.map((etiqueta, indice) => ({
    etiqueta,
    horas: Array.from({ length: 24 }, (_, hora) => totales.get(`${indice + 1}:${hora}`) ?? 0),
  }));
}

function diaSemanaIso(fecha) {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay() || 7;
}

async function obtenerMetricasAgenda(filtros = {}) {
  const rangoFechas = normalizarRango(filtros);
  const [areas, doctores] = await Promise.all([
    repository.listarAreas(),
    repository.listarDoctores(),
  ]);
  const areaSolicitada = Number.parseInt(filtros.area, 10);
  const doctorSolicitado = Number.parseInt(filtros.doctor, 10);
  const areaSeleccionada = areas.some((area) => Number(area.id) === areaSolicitada)
    ? areaSolicitada
    : null;
  const doctorSeleccionado = doctores.some((doctor) => Number(doctor.id) === doctorSolicitado)
    ? doctorSolicitado
    : null;
  const rango = {
    ...rangoFechas,
    areaId: areaSeleccionada,
    doctorId: doctorSeleccionado,
  };

  const [
    porDiaRaw,
    porDiaAreaRaw,
    porAreaRaw,
    porDoctorRaw,
    porEspecieRaw,
    porDiaSemanaRaw,
    porDuracionRaw,
    porDiaHoraRaw,
    porAreaDoctorRaw,
  ] = await Promise.all([
    repository.contarPorDia(rango),
    repository.contarPorDiaArea(rango),
    repository.contarPorArea(rango),
    repository.contarPorDoctor(rango),
    repository.contarPorEspecie(rango),
    repository.contarPorDiaSemana(rango),
    repository.contarPorDuracion(rango),
    repository.contarPorDiaHora(rango),
    repository.contarPorAreaDoctor(rango),
  ]);

  const porDia = rellenarDias(rangoFechas, porDiaRaw);
  const total = porDia.reduce((suma, fila) => suma + fila.total, 0);
  const demandaPorHora = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0 }));
  porDiaHoraRaw.forEach((fila) => {
    demandaPorHora[Number(fila.hora)].total += Number(fila.total);
  });
  const horaMayor = demandaPorHora.reduce(
    (mayor, fila) => (fila.total > mayor.total ? fila : mayor),
    { hora: 0, total: 0 },
  );
  const totalesDiaSemana = new Map(
    porDiaSemanaRaw.map((fila) => [Number(fila.dia_semana), Number(fila.total)]),
  );
  const aparicionesDiaSemana = new Map();
  porDia.forEach((fila) => {
    const dia = diaSemanaIso(fila.fecha);
    aparicionesDiaSemana.set(dia, (aparicionesDiaSemana.get(dia) ?? 0) + 1);
  });
  const porDiaSemana = DIAS_SEMANA.map((etiqueta, indice) => ({
    dia: indice + 1,
    etiqueta,
    total: totalesDiaSemana.get(indice + 1) ?? 0,
  }));
  const diaMayor = porDiaSemana.reduce(
    (mayor, fila) => (fila.total > mayor.total ? fila : mayor),
    { dia: 0, etiqueta: '—', total: 0 },
  );
  const promedioDiaMayor = diaMayor.total
    ? diaMayor.total / (aparicionesDiaSemana.get(diaMayor.dia) ?? 1)
    : 0;
  const totalesDuracion = new Map(
    porDuracionRaw.map((fila) => [Number(fila.minutos), Number(fila.total)]),
  );
  const porArea = porAreaRaw.map((fila) => ({ nombre: fila.nombre, total: Number(fila.total) }));

  return {
    rango: rangoFechas,
    areas: areas.map((area) => ({ id: Number(area.id), nombre: area.nombre })),
    doctores: doctores.map((doctor) => ({
      id: Number(doctor.id),
      nombre: `${doctor.nombre} ${doctor.apellidos}`,
    })),
    areaSeleccionada,
    doctorSeleccionado,
    total,
    promedioDiario: Math.round((total / porDia.length) * 10) / 10,
    diaMayorDemanda: diaMayor.total ? diaMayor.etiqueta : '—',
    promedioDiaMayorDemanda: Math.round(promedioDiaMayor * 10) / 10,
    horarioMayorDemanda: horaMayor.total ? `${String(horaMayor.hora).padStart(2, '0')}:00` : '—',
    areaMasSolicitada: porArea[0]?.nombre ?? '—',
    porcentajeAreaMasSolicitada: total ? Math.round(((porArea[0]?.total ?? 0) / total) * 100) : 0,
    porDia,
    porDiaArea: porDiaAreaRaw.map((fila) => ({
      fecha: formatoFecha(new Date(fila.fecha)),
      area: fila.area,
      total: Number(fila.total),
    })),
    porArea,
    porDoctor: porDoctorRaw.map((fila) => ({
      nombre: `${fila.nombre} ${fila.apellidos}`,
      total: Number(fila.total),
    })),
    porDiaSemana,
    demandaDiaHorario: normalizarDemandaDiaHorario(porDiaHoraRaw),
    porEspecie: porEspecieRaw.map((fila) => ({ nombre: fila.nombre, total: Number(fila.total) })),
    porDuracion: DURACIONES.map((minutos) => ({
      etiqueta: `${minutos} min`,
      total: totalesDuracion.get(minutos) ?? 0,
    })),
    porAreaDoctor: porAreaDoctorRaw.map((fila) => ({
      area: fila.area,
      doctor: `${fila.nombre} ${fila.apellidos}`,
      total: Number(fila.total),
    })),
    mapaHorarios: normalizarMapa(porDiaHoraRaw),
  };
}

module.exports = { obtenerMetricasAgenda };
