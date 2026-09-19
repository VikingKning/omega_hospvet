jest.mock('../../src/modules/metricas/metricas-whatsapp.repository');
const repository = require('../../src/modules/metricas/metricas-whatsapp.repository');
const { obtenerMetricasWhatsapp } = require('../../src/modules/metricas/metricas-whatsapp.service');

function preparar(overrides = {}) {
  repository.obtenerResumen.mockResolvedValue(
    overrides.resumen ?? { total: '0', exitosos: '0', fallidos: '0' },
  );
  repository.contarPorPeriodo.mockResolvedValue(overrides.periodos ?? []);
  repository.contarPorPlantilla.mockResolvedValue(overrides.plantillas ?? []);
  repository.listarErrores.mockResolvedValue(overrides.errores ?? []);
  repository.contarPorDiaHora.mockResolvedValue(overrides.diaHora ?? []);
  repository.topPlantillasConFallos.mockResolvedValue(overrides.plantillasConFallos ?? []);
  repository.obtenerResumenConversacional.mockResolvedValue(
    overrides.resumenConversacional ?? {
      mensajes_entrantes: '0',
      fragmentos_procesables: '0',
      grupos_procesados: '0',
      grupos_sin_claude: '0',
      llamadas_claude: '0',
      transferencias_humanas: '0',
      emergencias_confirmadas: '0',
      pipeline_nuevo: '0',
      pipeline_anterior: '0',
    },
  );
  repository.contarTendenciaConversacional.mockResolvedValue(
    overrides.tendenciaConversacional ?? [],
  );
  repository.obtenerAgrupacionConversacional.mockResolvedValue(
    overrides.agrupacionConversacional ?? {
      resumen: { grupos: '0', fragmentos: '0' },
      distribucion: [],
    },
  );
  repository.contarRutasConversacionales.mockResolvedValue(overrides.rutasConversacionales ?? []);
  repository.contarSeleccionesMenu.mockResolvedValue(overrides.seleccionesMenu ?? []);
  repository.obtenerUsoClaude.mockResolvedValue(
    overrides.usoClaude ?? {
      resumen: {
        llamadas: '0',
        tokens_entrada: '0',
        tokens_salida: '0',
        grupos_cero: '0',
        grupos_una: '0',
        grupos_dos_o_mas: '0',
        unidades_con_claude: '0',
      },
      categorias: [],
      resultados: [],
    },
  );
  repository.obtenerDescartesYReintentos.mockResolvedValue(overrides.descartes ?? {});
  repository.obtenerTiemposProcesamiento.mockResolvedValue(overrides.tiempos ?? {});
  repository.obtenerAtencionYAlertas.mockResolvedValue(
    overrides.atencion ?? { transferencias: [], alertas: [], canales: [], destinatarios: {} },
  );
  repository.contarMapaCalorConversacional.mockResolvedValue(overrides.mapaConversacional ?? []);
  repository.ZONA_HORARIA = 'America/Mexico_City';
}

beforeEach(() => {
  jest.clearAllMocks();
  preparar();
});

describe('metricas-whatsapp.service', () => {
  it('calcula los seis KPIs principales', async () => {
    preparar({
      resumen: { total: '10', exitosos: '8', fallidos: '2' },
      plantillas: [
        { plantilla: 'resultados_laboratorio_listos_v2', total: '7' },
        { plantilla: 'recordatorio_cita', total: '3' },
      ],
      errores: [{ error_codigo: '131030', error_mensaje: 'Invalid recipient phone', total: '2' }],
    });

    const resultado = await obtenerMetricasWhatsapp({
      desde: '2026-09-01',
      hasta: '2026-09-10',
    });

    expect(resultado).toMatchObject({
      total: 10,
      exitosos: 8,
      fallidos: 2,
      tasaExito: 80,
      promedioDiario: 1,
      plantillaMasUtilizada: 'resultados_laboratorio_listos_v2',
      usosPlantillaMasUtilizada: 7,
      errorMasFrecuente: 'Teléfono inválido',
      ocurrenciasErrorMasFrecuente: 2,
    });
  });

  it('agrupa las plantillas en las cuatro categorías solicitadas', async () => {
    preparar({
      plantillas: [
        { plantilla: 'resultados_laboratorio_listos_v2', total: '4' },
        { plantilla: 'recordatorio_cita', total: '3' },
        { plantilla: 'cambio_horario', total: '2' },
        { plantilla: 'emergencia_medica', total: '1' },
      ],
    });

    const { mensajesPorPlantilla } = await obtenerMetricasWhatsapp({
      desde: '2026-09-01',
      hasta: '2026-09-10',
    });

    expect(mensajesPorPlantilla).toEqual([
      { nombre: 'Resultados de laboratorio', total: 4 },
      { nombre: 'Recordatorios', total: 3 },
      { nombre: 'Cambios de horario', total: 2 },
      { nombre: 'Otras plantillas', total: 1 },
    ]);
  });

  it('normaliza día, hora y ambos modos del mapa de calor', async () => {
    preparar({
      diaHora: [{ dia_semana: '1', hora: '8', total: '5', fallidos: '2' }],
    });

    const resultado = await obtenerMetricasWhatsapp({
      desde: '2026-09-01',
      hasta: '2026-09-10',
    });

    expect(resultado.porDiaSemana[0]).toEqual({ etiqueta: 'Lunes', total: 5 });
    expect(resultado.porHora[8]).toEqual({ etiqueta: '08:00', total: 5 });
    expect(resultado.mapaCalor).toHaveLength(7);
    expect(resultado.mapaCalor[0].enviados[8]).toBe(5);
    expect(resultado.mapaCalor[0].errores[8]).toBe(2);
  });

  it('respeta la agrupación solicitada para tendencia', async () => {
    await obtenerMetricasWhatsapp({
      desde: '2026-01-01',
      hasta: '2026-06-30',
      agrupacion: 'mes',
    });

    expect(repository.contarPorPeriodo).toHaveBeenCalledWith(
      { desde: '2026-01-01', hasta: '2026-06-30' },
      'mes',
    );
  });

  it('calcula los siete KPIs conversacionales sin dividir entre cero', async () => {
    preparar({
      resumenConversacional: {
        mensajes_entrantes: '5',
        fragmentos_procesables: '5',
        grupos_procesados: '2',
        grupos_sin_claude: '1',
        llamadas_claude: '1',
        transferencias_humanas: '1',
        emergencias_confirmadas: '1',
        pipeline_nuevo: '5',
        pipeline_anterior: '0',
      },
    });

    const { conversacional } = await obtenerMetricasWhatsapp({
      desde: '2026-09-01',
      hasta: '2026-09-10',
    });

    expect(conversacional.kpis).toEqual({
      mensajesEntrantes: 5,
      gruposProcesados: 2,
      reduccionAgrupacion: 60,
      tasaSinClaude: 50,
      llamadasClaude: 1,
      transferenciasHumanas: 1,
      emergenciasConfirmadas: 1,
    });
  });
});
