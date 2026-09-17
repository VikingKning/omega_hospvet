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
const RUTAS_CONVERSACIONALES = [
  'atencion_humana',
  'respuesta_interactiva',
  'comando_menu',
  'medio_sin_texto',
  'flujo_activo',
  'saludo_puro',
  'consulta_libre_sin_claude',
  'consulta_libre_claude',
];
const RESULTADOS_CLAUDE = [
  'exito',
  'sin_coincidencia',
  'timeout',
  'no_configurado',
  'etiqueta_invalida',
  'error_api',
];
const ORIGENES_ATENCION = ['emergencia', 'recepcion', 'inicio_manual_omega'];

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

function numero(valor) {
  return Number(valor ?? 0);
}

function porcentaje(numerador, denominador) {
  return denominador ? Math.round((numerador / denominador) * 1000) / 10 : 0;
}

function normalizarTendenciaConversacional(rango, filas) {
  const datos = new Map(
    filas.map((fila) => [
      formatoFecha(new Date(fila.periodo)),
      {
        mensajes: numero(fila.mensajes),
        grupos: numero(fila.grupos),
        respuestas: numero(fila.respuestas),
      },
    ]),
  );
  const cursor = new Date(`${rango.desde}T00:00:00Z`);
  const fin = new Date(`${rango.hasta}T00:00:00Z`);
  const resultado = [];
  while (cursor <= fin) {
    const periodo = formatoFecha(cursor);
    resultado.push({
      periodo,
      etiqueta: periodo,
      ...(datos.get(periodo) ?? { mensajes: 0, grupos: 0, respuestas: 0 }),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return resultado;
}

function construirMapaConversacional(filas) {
  const celdas = new Map(
    filas.map((fila) => [
      `${numero(fila.dia_semana)}:${numero(fila.hora)}`,
      {
        total: numero(fila.total),
        emergencias: numero(fila.emergencias),
        recepcion: numero(fila.recepcion),
      },
    ]),
  );
  return DIAS_SEMANA.map((etiqueta, indice) => ({
    etiqueta,
    total: Array.from({ length: 24 }, (_, hora) => celdas.get(`${indice + 1}:${hora}`)?.total ?? 0),
    emergencias: Array.from(
      { length: 24 },
      (_, hora) => celdas.get(`${indice + 1}:${hora}`)?.emergencias ?? 0,
    ),
    recepcion: Array.from(
      { length: 24 },
      (_, hora) => celdas.get(`${indice + 1}:${hora}`)?.recepcion ?? 0,
    ),
  }));
}

function completarConteos(claves, filas, campo = 'etiqueta') {
  const totales = new Map(filas.map((fila) => [fila[campo], numero(fila.total)]));
  return claves.map((clave) => ({ etiqueta: clave, total: totales.get(clave) ?? 0 }));
}

async function obtenerMetricasWhatsapp(filtros = {}) {
  const rango = normalizarRango(filtros);
  const agrupacion = resolverAgrupacion(filtros.agrupacion, rango);
  const [
    resumenRaw,
    periodosRaw,
    plantillasRaw,
    erroresRaw,
    diaHoraRaw,
    fallosPlantillaRaw,
    resumenConversacionalRaw,
    tendenciaConversacionalRaw,
    agrupacionConversacionalRaw,
    rutasConversacionalesRaw,
    seleccionesMenuRaw,
    usoClaudeRaw,
    descartesRaw,
    tiemposRaw,
    atencionRaw,
    mapaConversacionalRaw,
  ] = await Promise.all([
    repository.obtenerResumen(rango),
    repository.contarPorPeriodo(rango, agrupacion),
    repository.contarPorPlantilla(rango),
    repository.listarErrores(rango),
    repository.contarPorDiaHora(rango),
    repository.topPlantillasConFallos(rango),
    repository.obtenerResumenConversacional(rango),
    repository.contarTendenciaConversacional(rango),
    repository.obtenerAgrupacionConversacional(rango),
    repository.contarRutasConversacionales(rango),
    repository.contarSeleccionesMenu(rango),
    repository.obtenerUsoClaude(rango),
    repository.obtenerDescartesYReintentos(rango),
    repository.obtenerTiemposProcesamiento(rango),
    repository.obtenerAtencionYAlertas(rango),
    repository.contarMapaCalorConversacional(rango),
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

  const mensajesEntrantes = numero(resumenConversacionalRaw?.mensajes_entrantes);
  const fragmentosProcesables = numero(resumenConversacionalRaw?.fragmentos_procesables);
  const gruposProcesados = numero(resumenConversacionalRaw?.grupos_procesados);
  const gruposSinClaude = numero(resumenConversacionalRaw?.grupos_sin_claude);
  const llamadasClaude = numero(resumenConversacionalRaw?.llamadas_claude);
  const resumenClaude = usoClaudeRaw?.resumen ?? {};
  const tokensTotales = numero(resumenClaude.tokens_entrada) + numero(resumenClaude.tokens_salida);
  const gruposConClaude = numero(resumenClaude.unidades_con_claude);
  const alertas = (atencionRaw?.alertas ?? []).map((fila) => ({
    tipo: fila.tipo_alerta,
    estado: fila.estado,
    total: numero(fila.total),
    segundosAtencion: numero(fila.segundos_atencion),
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
    zonaHoraria: repository.ZONA_HORARIA,
    conversacional: {
      kpis: {
        mensajesEntrantes,
        gruposProcesados,
        reduccionAgrupacion: porcentaje(
          Math.max(fragmentosProcesables - gruposProcesados, 0),
          fragmentosProcesables,
        ),
        tasaSinClaude: porcentaje(gruposSinClaude, gruposProcesados),
        llamadasClaude,
        transferenciasHumanas: numero(resumenConversacionalRaw?.transferencias_humanas),
        emergenciasConfirmadas: numero(resumenConversacionalRaw?.emergencias_confirmadas),
      },
      pipeline: [
        {
          etiqueta: 'Router conversacional',
          total: numero(resumenConversacionalRaw?.pipeline_nuevo),
        },
        { etiqueta: 'Flujo anterior', total: numero(resumenConversacionalRaw?.pipeline_anterior) },
      ],
      tendencia: normalizarTendenciaConversacional(rango, tendenciaConversacionalRaw ?? []),
      agrupacion: {
        fragmentos: numero(agrupacionConversacionalRaw?.resumen?.fragmentos),
        grupos: numero(agrupacionConversacionalRaw?.resumen?.grupos),
        distribucion: (agrupacionConversacionalRaw?.distribucion ?? []).map((fila) => ({
          etiqueta: `${numero(fila.cantidad_fragmentos)} fragmento${numero(fila.cantidad_fragmentos) === 1 ? '' : 's'}`,
          total: numero(fila.total),
        })),
      },
      rutas: completarConteos(RUTAS_CONVERSACIONALES, rutasConversacionalesRaw ?? [], 'ruta'),
      menu: (seleccionesMenuRaw ?? []).map((fila) => ({
        identificador: fila.identificador,
        total: numero(fila.total),
      })),
      claude: {
        llamadas: numero(resumenClaude.llamadas),
        tokensEntrada: numero(resumenClaude.tokens_entrada),
        tokensSalida: numero(resumenClaude.tokens_salida),
        promedioTokensGrupo: gruposConClaude
          ? Math.round((tokensTotales / gruposConClaude) * 10) / 10
          : 0,
        gruposCero: numero(resumenClaude.grupos_cero),
        gruposUna: numero(resumenClaude.grupos_una),
        gruposDosOMas: numero(resumenClaude.grupos_dos_o_mas),
        categorias: (usoClaudeRaw?.categorias ?? []).map((fila) => ({
          etiqueta: fila.categoria,
          total: numero(fila.total),
        })),
        resultados: completarConteos(
          RESULTADOS_CLAUDE,
          usoClaudeRaw?.resultados ?? [],
          'resultado',
        ),
      },
      descartes: {
        mensajesNoSoportados: numero(descartesRaw?.mensajes_no_soportados),
        eventosEstado: numero(descartesRaw?.eventos_estado),
        duplicadosMeta: numero(descartesRaw?.duplicados_meta),
        reintentosRouter: numero(descartesRaw?.reintentos_router),
        reintentosEnvio: numero(descartesRaw?.reintentos_envio),
      },
      tiempos: {
        segundosFragmentoDecision: numero(tiemposRaw?.segundos_fragmento_decision),
        segundosDecisionEnvio: numero(tiemposRaw?.segundos_decision_envio),
      },
      atencion: {
        transferencias: completarConteos(
          ORIGENES_ATENCION,
          atencionRaw?.transferencias ?? [],
          'origen',
        ),
        alertas,
        pendientes: alertas
          .filter((fila) => fila.estado === 'pendiente')
          .reduce((suma, fila) => suma + fila.total, 0),
        atendidas: alertas
          .filter((fila) => fila.estado === 'atendida')
          .reduce((suma, fila) => suma + fila.total, 0),
        promedioSegundosAtencion: (() => {
          const atendidas = alertas.filter((fila) => fila.estado === 'atendida' && fila.total > 0);
          const cantidad = atendidas.reduce((suma, fila) => suma + fila.total, 0);
          return cantidad
            ? Math.round(
                atendidas.reduce((suma, fila) => suma + fila.segundosAtencion * fila.total, 0) /
                  cantidad,
              )
            : 0;
        })(),
        canales: (atencionRaw?.canales ?? []).map((fila) => ({
          canal: fila.canal,
          estado: fila.estado,
          total: numero(fila.total),
        })),
        destinatariosSeleccionados: numero(atencionRaw?.destinatarios?.destinatarios_seleccionados),
        enviosWhatsappUnicos: numero(atencionRaw?.destinatarios?.envios_whatsapp_unicos),
      },
      mapaCalor: construirMapaConversacional(mapaConversacionalRaw ?? []),
    },
  };
}

module.exports = { obtenerMetricasWhatsapp, porcentaje };
