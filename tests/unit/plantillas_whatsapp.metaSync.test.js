jest.mock('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
jest.mock('../../src/config/whatsapp');
const repository = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
const whatsappConfig = require('../../src/config/whatsapp');
const {
  revisarAprobaciones,
  sincronizarDatosMeta,
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

    expect(repository.findParaSincronizarMeta).not.toHaveBeenCalled();
  });

  it('sin plantillas locales, no llama a Meta', async () => {
    repository.findParaSincronizarMeta.mockResolvedValue([]);
    global.fetch = jest.fn();

    await revisarAprobaciones();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sincroniza estado y categoría, incluyendo reclasificaciones de Meta', async () => {
    repository.findParaSincronizarMeta.mockResolvedValue([
      { id: 1, slug: 'dosis-olvidada', aprobado_meta: false, categoria_meta: 'UTILITY' },
      {
        id: 2,
        slug: 'pregunta-alimentacion-dieta',
        aprobado_meta: true,
        categoria_meta: 'UTILITY',
      },
      { id: 3, slug: 'revision-herida-foto', aprobado_meta: false, categoria_meta: 'UTILITY' },
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { name: 'dosis_olvidada', status: 'APPROVED', category: 'UTILITY' },
            {
              name: 'pregunta_alimentacion_dieta',
              status: 'APPROVED',
              category: 'MARKETING',
            },
            // revision_herida_foto ni siquiera aparece todavía en la lista de Meta
          ],
        }),
    });

    await revisarAprobaciones();

    expect(repository.actualizarDatosMeta).toHaveBeenCalledTimes(2);
    expect(repository.actualizarDatosMeta).toHaveBeenCalledWith(1, {
      categoriaMeta: 'UTILITY',
      aprobadoMeta: true,
    });
    expect(repository.actualizarDatosMeta).toHaveBeenCalledWith(2, {
      categoriaMeta: 'MARKETING',
      aprobadoMeta: true,
    });
  });

  // Pedido explícito del usuario (2026-09-12): una plantilla de texto
  // libre nunca se registró a propósito — aunque Meta reporte un template
  // con ese mismo nombre (ej. quedó de un registro manual viejo), no debe
  // pisarse la decisión local. En la práctica repository.findParaSincronizarMeta
  // ya las excluye por SQL, pero este test cubre también la ruta directa
  // (scripts/estado-plantillas-whatsapp.js le pasa `plantillasLocales`
  // explícito, sin pasar por ese filtro).
  it('nunca sincroniza una plantilla de texto libre, aunque Meta reporte un template con ese nombre', async () => {
    const actualizadas = await sincronizarDatosMeta(
      [{ name: 'dosis_olvidada', status: 'APPROVED', category: 'UTILITY' }],
      [{ id: 1, slug: 'dosis-olvidada', aprobado_meta: false, categoria_meta: 'TEXTO_LIBRE' }],
    );

    expect(actualizadas).toBe(0);
    expect(repository.actualizarDatosMeta).not.toHaveBeenCalled();
  });

  it('si Meta responde con error HTTP, no marca nada y no truena', async () => {
    repository.findParaSincronizarMeta.mockResolvedValue([
      { id: 1, slug: 'dosis-olvidada', aprobado_meta: false, categoria_meta: 'UTILITY' },
    ]);
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await expect(revisarAprobaciones()).resolves.toBeUndefined();
    expect(repository.actualizarDatosMeta).not.toHaveBeenCalled();
  });

  it('si el fetch a Meta truena (red caída), no truena el ciclo', async () => {
    repository.findParaSincronizarMeta.mockResolvedValue([
      { id: 1, slug: 'dosis-olvidada', aprobado_meta: false, categoria_meta: 'UTILITY' },
    ]);
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(revisarAprobaciones()).resolves.toBeUndefined();
    expect(repository.actualizarDatosMeta).not.toHaveBeenCalled();
  });
});
