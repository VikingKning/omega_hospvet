// Al entrar al módulo (GET /plantillas.html) se revisa Meta de inmediato,
// no solo se espera el job de cada 60 min (pedido explícito del usuario)
// — revisarAprobaciones() ya está probado a fondo por su cuenta en
// plantillas_whatsapp.metaSync.test.js, aquí solo se cubre que list()
// realmente la llama, y ANTES de leer el catálogo (para que la página
// recién cargada ya refleje lo que Meta acaba de confirmar).
jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.service');
jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.metaSync');
jest.mock('../../src/config/csrf');
const service = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.service');
const metaSync = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.metaSync');
const { generateCsrfToken } = require('../../src/config/csrf');
const { list } = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.controller');

function makeRes() {
  return { render: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  generateCsrfToken.mockReturnValue('csrf-fake');
  service.list.mockResolvedValue({ plantillas: [] });
});

describe('plantillas_whatsapp.controller.list', () => {
  it('revisa aprobaciones de Meta antes de leer el catálogo', async () => {
    const orden = [];
    metaSync.revisarAprobaciones.mockImplementation(async () => {
      orden.push('metaSync');
    });
    service.list.mockImplementation(async () => {
      orden.push('service.list');
      return { plantillas: [] };
    });

    const req = { session: { user: { id: 1 } } };
    const res = makeRes();

    await list(req, res, jest.fn());

    expect(orden).toEqual(['metaSync', 'service.list']);
    expect(res.render).toHaveBeenCalled();
  });

  it('si revisarAprobaciones tronara, la página igual se renderiza (next con el error, nunca se cae silenciosa)', async () => {
    metaSync.revisarAprobaciones.mockRejectedValue(new Error('inesperado'));
    const req = { session: { user: { id: 1 } } };
    const res = makeRes();
    const next = jest.fn();

    await list(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.render).not.toHaveBeenCalled();
  });
});
