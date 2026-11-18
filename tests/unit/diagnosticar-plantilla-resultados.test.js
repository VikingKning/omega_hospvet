const whatsapp = require('../../src/config/whatsapp');
const {
  diagnosticarPlantillaResultados,
} = require('../../scripts/diagnosticar-plantilla-resultados');

beforeEach(() => {
  jest
    .spyOn(whatsapp, 'templatesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/message_templates');
  jest.spyOn(whatsapp, 'bearerHeader').mockReturnValue({ Authorization: 'Bearer secreto-prueba' });
});
afterEach(() => jest.restoreAllMocks());

it.each(['PENDING', 'APPROVED', 'REJECTED'])(
  'consulta %s mediante GET sin modificar Meta o revelar credenciales',
  async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: '123',
            name: 'resultados_laboratorio_listos_v2',
            language: 'es_MX',
            status,
            category: 'UTILITY',
          },
        ],
      }),
    });
    const resultado = await diagnosticarPlantillaResultados(fetchImpl);
    expect(resultado.disponible_para_envio).toBe(status === 'APPROVED');
    expect(resultado.plantillas[0].estado).toBe(status);
    expect(resultado.consulta_completa).toBe(true);
    expect(resultado.ultima_modificacion_meta).toMatch(/No informada/);
    expect(JSON.stringify(resultado)).not.toContain('secreto-prueba');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchImpl.mock.calls[0];
    expect(new URL(url).searchParams.get('name')).toBe('resultados_laboratorio_listos_v2');
    expect(opciones.method).toBe('GET');
    expect(opciones.body).toBeUndefined();
  },
);

it('no considera aprobada una traducción diferente ni otra plantilla', async () => {
  const resultado = await diagnosticarPlantillaResultados(async () => ({
    ok: true,
    json: async () => ({
      data: [
        { name: 'resultados_laboratorio_listos_v2', language: 'es', status: 'APPROVED' },
        { name: 'resultados_laboratorio_listos_v', language: 'es_MX', status: 'APPROVED' },
      ],
    }),
  }));
  expect(resultado.disponible_para_envio).toBe(false);
  expect(resultado.plantillas).toHaveLength(1);
});

it('reporta el error técnico sin volcar el cuerpo de respuesta', async () => {
  await expect(
    diagnosticarPlantillaResultados(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: 200, fbtrace_id: 'trace-lab', message: 'Detalle no necesario' },
      }),
    })),
  ).rejects.toThrow('HTTP 403, código 200, referencia trace-lab');
});
