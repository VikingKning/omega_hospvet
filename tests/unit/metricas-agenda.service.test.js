jest.mock('../../src/modules/metricas/metricas-agenda.repository');
const repository = require('../../src/modules/metricas/metricas-agenda.repository');
const { obtenerMetricasAgenda } = require('../../src/modules/metricas/metricas-agenda.service');

function preparar(overrides = {}) {
  repository.listarAreas.mockResolvedValue(
    overrides.areas ?? [
      { id: 1, nombre: 'Consultas' },
      { id: 2, nombre: 'Estética' },
    ],
  );
  repository.listarDoctores.mockResolvedValue(
    overrides.doctoresCatalogo ?? [{ id: 10, nombre: 'Ana', apellidos: 'López' }],
  );
  repository.contarPorDia.mockResolvedValue(overrides.porDia ?? []);
  repository.contarPorDiaArea.mockResolvedValue(overrides.porDiaArea ?? []);
  repository.contarPorArea.mockResolvedValue(overrides.porArea ?? []);
  repository.contarPorDoctor.mockResolvedValue(overrides.porDoctor ?? []);
  repository.contarPorEspecie.mockResolvedValue(overrides.porEspecie ?? []);
  repository.contarPorDiaSemana.mockResolvedValue(overrides.porDiaSemana ?? []);
  repository.contarPorDuracion.mockResolvedValue(overrides.porDuracion ?? []);
  repository.contarPorDiaHora.mockResolvedValue(overrides.porDiaHora ?? []);
  repository.contarPorAreaDoctor.mockResolvedValue(overrides.porAreaDoctor ?? []);
}

beforeEach(() => jest.clearAllMocks());

describe('metricas-agenda.service', () => {
  it('calcula los cinco KPIs solicitados con los datos de agenda', async () => {
    preparar({
      porDia: [
        { fecha: '2026-09-01', total: '2' },
        { fecha: '2026-09-02', total: '4' },
      ],
      porArea: [
        { nombre: 'Consultas', total: '5' },
        { nombre: 'Estética', total: '1' },
      ],
      porDiaSemana: [
        { dia_semana: '2', total: '2' },
        { dia_semana: '3', total: '4' },
      ],
      porDiaHora: [{ dia_semana: '3', hora: '10', total: '5' }],
    });

    const resultado = await obtenerMetricasAgenda({
      desde: '2026-09-01',
      hasta: '2026-09-03',
    });

    expect(resultado).toMatchObject({
      total: 6,
      promedioDiario: 2,
      diaMayorDemanda: 'Miércoles',
      promedioDiaMayorDemanda: 4,
      horarioMayorDemanda: '10:00',
      areaMasSolicitada: 'Consultas',
      porcentajeAreaMasSolicitada: 83,
    });
  });

  it('aplica simultáneamente los filtros válidos de área y doctor', async () => {
    preparar();

    const resultado = await obtenerMetricasAgenda({
      desde: '2026-09-01',
      hasta: '2026-09-07',
      area: '2',
      doctor: '10',
    });

    expect(resultado).toMatchObject({ areaSeleccionada: 2, doctorSeleccionado: 10 });
    expect(repository.contarPorDia).toHaveBeenCalledWith({
      desde: '2026-09-01',
      hasta: '2026-09-07',
      areaId: 2,
      doctorId: 10,
    });
  });

  it('normaliza días de semana y duraciones ausentes con cero', async () => {
    preparar({
      porDiaSemana: [{ dia_semana: '1', total: '3' }],
      porDuracion: [{ minutos: '30', total: '2' }],
    });

    const { porDiaSemana, porDuracion } = await obtenerMetricasAgenda({
      desde: '2026-09-01',
      hasta: '2026-09-07',
    });

    expect(porDiaSemana[0]).toEqual({ dia: 1, etiqueta: 'Lunes', total: 3 });
    expect(porDiaSemana[6]).toEqual({ dia: 7, etiqueta: 'Domingo', total: 0 });
    expect(porDuracion.find((fila) => fila.etiqueta === '30 min').total).toBe(2);
  });

  it('limita el mapa de calor a las 11 franjas entre 08:00 y 18:00', async () => {
    preparar({
      porDiaHora: [
        { dia_semana: '2', hora: '7', total: '9' },
        { dia_semana: '2', hora: '8', total: '2' },
        { dia_semana: '2', hora: '18', total: '4' },
      ],
    });

    const { mapaHorarios } = await obtenerMetricasAgenda({
      desde: '2026-09-01',
      hasta: '2026-09-07',
    });

    expect(mapaHorarios).toHaveLength(7);
    expect(mapaHorarios.every((dia) => dia.horas.length === 11)).toBe(true);
    expect(mapaHorarios[1].horas[0]).toBe(2);
    expect(mapaHorarios[1].horas[10]).toBe(4);
  });
});
