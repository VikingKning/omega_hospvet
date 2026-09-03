jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
jest.mock('../../src/config/whatsapp');
const repository = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
const whatsappConfig = require('../../src/config/whatsapp');
const {
  revisarAprobaciones,
} = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.metaSync');

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  whatsappConfig.isWhatsappConfigured.mockReturnValue(true);
  whatsappConfig.templatesUrl.mockReturnValue('https://graph.facebook.com/fake/message_templates');
  whatsappConfig.authHeaders.mockReturnValue({ Authorization: 'Bearer fake' });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('plantillas_whatsapp.metaSync.revisarAprobaciones', () => {
  it('sin WhatsApp configurado, no consulta el repository ni Meta', async () => {
    whatsappConfig.isWhatsappConfigured.mockReturnValue(false);

    await revisarAprobaciones();

    expect(repository.findPendientesAprobacionMeta).not.toHaveBeenCalled();
  });

  it('sin plantillas pendientes, no llama a Meta', async () => {
    repository.findPendientesAprobacionMeta.mockResolvedValue([]);
    global.fetch = jest.fn();

    await revisarAprobaciones();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('marca aprobado_meta=true solo las que Meta ya reporta como APPROVED', async () => {
    repository.findPendientesAprobacionMeta.mockResolvedValue([
      { id: 1, slug: 'dosis-olvidada' },
      { id: 2, slug: 'cambio-horario-medicacion' },
      { id: 3, slug: 'revision-herida-foto' },
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { name: 'dosis_olvidada', status: 'APPROVED' },
            { name: 'cambio_horario_medicacion', status: 'PENDING' },
            // revision_herida_foto ni siquiera aparece todavía en la lista de Meta
          ],
        }),
    });

    await revisarAprobaciones();

    expect(repository.marcarAprobadoMeta).toHaveBeenCalledTimes(1);
    expect(repository.marcarAprobadoMeta).toHaveBeenCalledWith(1);
  });

  it('si Meta responde con error HTTP, no marca nada y no truena', async () => {
    repository.findPendientesAprobacionMeta.mockResolvedValue([{ id: 1, slug: 'dosis-olvidada' }]);
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await expect(revisarAprobaciones()).resolves.toBeUndefined();
    expect(repository.marcarAprobadoMeta).not.toHaveBeenCalled();
  });

  it('si el fetch a Meta truena (red caída), no truena el ciclo', async () => {
    repository.findPendientesAprobacionMeta.mockResolvedValue([{ id: 1, slug: 'dosis-olvidada' }]);
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(revisarAprobaciones()).resolves.toBeUndefined();
    expect(repository.marcarAprobadoMeta).not.toHaveBeenCalled();
  });
});
