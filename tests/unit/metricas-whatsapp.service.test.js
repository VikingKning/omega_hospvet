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
});
