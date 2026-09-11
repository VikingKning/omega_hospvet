jest.mock('../../src/modules/metricas/metricas.repository');
const repository = require('../../src/modules/metricas/metricas.repository');
const { obtenerMetricasLaboratorio } = require('../../src/modules/metricas/metricas.service');

function mockearRepository(overrides = {}) {
  repository.contarPorEstado.mockResolvedValue(overrides.porEstado ?? []);
  repository.contarPorDia.mockResolvedValue(overrides.porDia ?? []);
  repository.topEstudios.mockResolvedValue(overrides.topEstudios ?? []);
  repository.topCategorias.mockResolvedValue(overrides.topCategorias ?? []);
  repository.topDoctores.mockResolvedValue(overrides.topDoctores ?? []);
  repository.contarRecepcionPorDiaHora.mockResolvedValue(overrides.mapaRecepcion ?? []);
  repository.contarPorEspecie.mockResolvedValue(overrides.porEspecie ?? []);
  repository.contarAntiguedadAbiertas.mockResolvedValue(overrides.antiguedadAbiertas ?? []);
  repository.contarEnviosPorCanalResultado.mockResolvedValue(overrides.enviosPorCanal ?? []);
  repository.tiemposPromedio.mockResolvedValue(
    overrides.tiempos ?? {
      horasPendienteACargado: null,
      horasCargadoAEnviado: null,
      horasPendienteAEnviado: null,
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizarRango (vía el campo `rango` que regresa obtenerMetricasLaboratorio)', () => {
  it('sin ningún filtro, usa los últimos 30 días (incluyendo hoy)', async () => {
    mockearRepository();

    const { rango } = await obtenerMetricasLaboratorio({});

    const hoy = new Date().toISOString().slice(0, 10);
    const hace29Dias = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(rango).toEqual({ desde: hace29Dias, hasta: hoy });
  });

  it('un desde/hasta con formato válido se usa tal cual', async () => {
    mockearRepository();

    const { rango } = await obtenerMetricasLaboratorio({
      desde: '2021-01-01',
      hasta: '2021-01-31',
    });

    expect(rango).toEqual({ desde: '2021-01-01', hasta: '2021-01-31' });
  });

  it('un desde/hasta con formato inválido cae al default de 30 días, no truena', async () => {
    mockearRepository();

    const { rango } = await obtenerMetricasLaboratorio({
      desde: 'no-es-fecha',
      hasta: '31/01/2021',
    });

    const hoy = new Date().toISOString().slice(0, 10);
    expect(rango.hasta).toBe(hoy);
  });

  it('un rango invertido (desde > hasta) se corrige intercambiando los extremos', async () => {
    mockearRepository();

    const { rango } = await obtenerMetricasLaboratorio({
      desde: '2021-06-01',
      hasta: '2021-01-01',
    });

    expect(rango).toEqual({ desde: '2021-01-01', hasta: '2021-06-01' });
  });

  it.each([
    [7, 6],
    [30, 29],
    [90, 89],
  ])('preset=%i calcula desde = hoy - %i días', async (preset, diasAtras) => {
    mockearRepository();

    const { rango } = await obtenerMetricasLaboratorio({ preset });

    const hoy = new Date().toISOString().slice(0, 10);
    const desdeEsperado = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(rango).toEqual({ desde: desdeEsperado, hasta: hoy });
  });

  it('un preset gana sobre desde/hasta que hayan llegado junto (los botones no limpian esos inputs)', async () => {
    mockearRepository();

    const { rango } = await obtenerMetricasLaboratorio({
      preset: 7,
      desde: '2019-01-01',
      hasta: '2019-01-01',
    });

    const hoy = new Date().toISOString().slice(0, 10);
    expect(rango.hasta).toBe(hoy);
    expect(rango.desde).not.toBe('2019-01-01');
  });

  it('un preset fuera del catálogo válido (7/30/90) se ignora, mismo default de 30 días', async () => {
    mockearRepository();

    const { rango } = await obtenerMetricasLaboratorio({ preset: 15 });

    const hoy = new Date().toISOString().slice(0, 10);
    const hace29Dias = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(rango).toEqual({ desde: hace29Dias, hasta: hoy });
  });
});

describe('obtenerMetricasLaboratorio — armado del resto de los datos', () => {
  it('porEstado siempre trae los 3 estados, con 0 para los que no vinieron del repository', async () => {
    mockearRepository({ porEstado: [{ estado: 'pendiente', total: '2' }] });

    const { porEstado, total } = await obtenerMetricasLaboratorio({});

    expect(porEstado).toEqual([
      { estado: 'pendiente', etiqueta: 'Pendiente', total: 2 },
      { estado: 'cargado', etiqueta: 'Cargado', total: 0 },
      { estado: 'enviado', etiqueta: 'Enviado', total: 0 },
    ]);
    expect(total).toBe(2);
  });

  it('rellenarDias rellena con 0 los días del rango sin ninguna orden, sin saltarse fechas', async () => {
    mockearRepository({ porDia: [{ fecha: '2021-01-02', total: '5' }] });

    const { porDia } = await obtenerMetricasLaboratorio({
      desde: '2021-01-01',
      hasta: '2021-01-04',
    });

    expect(porDia).toEqual([
      { fecha: '2021-01-01', total: 0 },
      { fecha: '2021-01-02', total: 5 },
      { fecha: '2021-01-03', total: 0 },
      { fecha: '2021-01-04', total: 0 },
    ]);
  });

  it('topDoctores etiqueta explícitamente las filas sin doctor asignado (doctor_id null, leftJoin)', async () => {
    mockearRepository({
      topDoctores: [
        { nombre: 'Ana', apellidos: 'Lopez', total: '4' },
        { nombre: null, apellidos: null, total: '1' },
      ],
    });

    const { topDoctores } = await obtenerMetricasLaboratorio({});

    expect(topDoctores).toEqual([
      { nombre: 'Ana Lopez', total: 4 },
      { nombre: 'Sin doctor asignado', total: 1 },
    ]);
  });

  it('los tiempos promedio se redondean a 1 decimal, y un null (sin datos aún) se conserva como null', async () => {
    mockearRepository({
      tiempos: {
        horasPendienteACargado: 2.3333333,
        horasCargadoAEnviado: null,
        horasPendienteAEnviado: 5.05,
      },
    });

    const { tiempos } = await obtenerMetricasLaboratorio({});

    expect(tiempos).toEqual({
      horasPendienteACargado: 2.3,
      horasCargadoAEnviado: null,
      horasPendienteAEnviado: 5.1,
    });
  });

  it('topEstudios/topCategorias convierten `total` a número (viene como string de Postgres count())', async () => {
    mockearRepository({
      topEstudios: [{ nombre: 'Biometría hemática', total: '7' }],
      topCategorias: [{ nombre: 'Hematología', total: '9' }],
    });

    const { topEstudios, topCategorias } = await obtenerMetricasLaboratorio({});

    expect(topEstudios).toEqual([{ nombre: 'Biometría hemática', total: 7 }]);
    expect(topCategorias).toEqual([{ nombre: 'Hematología', total: 9 }]);
  });

  it('el mapa de recepción siempre contiene los 7 días y las 24 horas, rellenando huecos con 0', async () => {
    mockearRepository({
      mapaRecepcion: [
        { dia_semana: '1', hora: '8', total: '3' },
        { dia_semana: '7', hora: '23', total: '2' },
      ],
    });

    const { mapaRecepcion } = await obtenerMetricasLaboratorio({});

    expect(mapaRecepcion).toHaveLength(7);
    expect(mapaRecepcion.every((dia) => dia.horas.length === 24)).toBe(true);
    expect(mapaRecepcion[0]).toMatchObject({ dia: 1, etiqueta: 'Lunes' });
    expect(mapaRecepcion[0].horas[8]).toBe(3);
    expect(mapaRecepcion[6].horas[23]).toBe(2);
    expect(mapaRecepcion[2].horas.every((total) => total === 0)).toBe(true);
  });

  it('órdenes por especie siempre entrega Perros y Gatos aunque alguno no tenga órdenes', async () => {
    mockearRepository({ porEspecie: [{ especie: 'perro', total: '4' }] });

    const { porEspecie } = await obtenerMetricasLaboratorio({});

    expect(porEspecie).toEqual([
      { especie: 'perro', etiqueta: 'Perros', total: 4 },
      { especie: 'gato', etiqueta: 'Gatos', total: 0 },
    ]);
  });

  it('la antigüedad conserva los 5 rangos y separa pendientes de cargadas sin enviar', async () => {
    mockearRepository({
      antiguedadAbiertas: [
        { rango: 'menos_1h', estado: 'pendiente', total: '2' },
        { rango: '1_6h', estado: 'cargado', total: '3' },
        { rango: 'mas_3d', estado: 'pendiente', total: '1' },
      ],
    });

    const { antiguedadAbiertas } = await obtenerMetricasLaboratorio({});

    expect(antiguedadAbiertas).toEqual([
      { rango: 'menos_1h', etiqueta: 'Menos de 1 hora', pendiente: 2, cargado: 0 },
      { rango: '1_6h', etiqueta: '1–6 horas', pendiente: 0, cargado: 3 },
      { rango: '6_24h', etiqueta: '6–24 horas', pendiente: 0, cargado: 0 },
      { rango: '1_3d', etiqueta: '1–3 días', pendiente: 0, cargado: 0 },
      { rango: 'mas_3d', etiqueta: 'Más de 3 días', pendiente: 1, cargado: 0 },
    ]);
  });

  it('los envíos conservan los 3 canales y separan resultados exitosos y fallidos', async () => {
    mockearRepository({
      enviosPorCanal: [
        { canal: 'whatsapp', resultado: 'exitoso', total: '5' },
        { canal: 'correo', resultado: 'fallido', total: '2' },
        { canal: 'ambos', resultado: 'exitoso', total: '3' },
        { canal: 'ambos', resultado: 'fallido', total: '1' },
      ],
    });

    const { enviosPorCanal } = await obtenerMetricasLaboratorio({});

    expect(enviosPorCanal).toEqual([
      { canal: 'whatsapp', etiqueta: 'Solo WhatsApp', exitosos: 5, fallidos: 0 },
      { canal: 'correo', etiqueta: 'Solo Correo', exitosos: 0, fallidos: 2 },
      { canal: 'ambos', etiqueta: 'Ambos medios', exitosos: 3, fallidos: 1 },
    ]);
  });
});
