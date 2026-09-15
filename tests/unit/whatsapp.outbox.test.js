// US WA 015 — orquestación de envíos salientes idempotentes
// (whatsapp.outbox.js). Se mockea whatsapp.repository wholesale porque
// estas pruebas son sobre la LÓGICA de reintento/idempotencia — la
// idempotencia real de Postgres (índice único de wamid, ventana de
// servicio contra el reloj real) vive en tests/integration/whatsapp.outbox.test.js.
jest.mock('../../src/modules/whatsapp/whatsapp.repository');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const {
  registrarIntento,
  ejecutarIntento,
  registrarEstadoMeta,
} = require('../../src/modules/whatsapp/whatsapp.outbox');

const originalFetch = global.fetch;

const PAYLOAD_TEXTO = { tipo: 'text', destinatarioTelefono: '525500000000', texto: 'hola' };

function intentoBase(overrides = {}) {
  return {
    intent_id: 1,
    clave_idempotencia: 'clave-1',
    tipo_envio: 'conversacional',
    conversacion_id: null,
    destinatario_telefono: '525500000000',
    payload_funcional: PAYLOAD_TEXTO,
    wamid: null,
    estado: 'pendiente',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  repository.reclamarIntentoEnvio.mockImplementation(async (clave) => {
    const intent = await repository.buscarIntentoPorClave(clave);
    const reclamado = Boolean(
      intent &&
      !intent.wamid &&
      !['enviado', 'cancelado', 'ventana_servicio_expirada', 'enviando'].includes(intent.estado),
    );
    return { intent, reclamado };
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('whatsapp.outbox.registrarIntento', () => {
  it('delega en repository.registrarIntentoEnvio (AC1)', async () => {
    repository.registrarIntentoEnvio.mockResolvedValue({ intent: intentoBase(), esNuevo: true });

    const resultado = await registrarIntento({ claveIdempotencia: 'clave-1' });

    expect(repository.registrarIntentoEnvio).toHaveBeenCalledWith(
      { claveIdempotencia: 'clave-1' },
      undefined,
    );
    expect(resultado.esNuevo).toBe(true);
  });
});

describe('whatsapp.outbox.ejecutarIntento', () => {
  it('un payload tipo interactive se reenvía tal cual a Meta (US WA 004)', async () => {
    const interactive = {
      type: 'list',
      body: { text: 'x' },
      action: { button: 'Ver', sections: [] },
    };
    repository.buscarIntentoPorClave.mockResolvedValue(
      intentoBase({
        payload_funcional: {
          tipo: 'interactive',
          destinatarioTelefono: '525500000000',
          interactive,
        },
      }),
    );

    await ejecutarIntento('clave-1');

    const [, opciones] = global.fetch.mock.calls[0];
    const body = JSON.parse(opciones.body);
    expect(body.type).toBe('interactive');
    expect(body.interactive).toEqual(interactive);
  });

  it('caída ANTES de que Meta acepte: marca fallido, sin wamid (prueba mínima 1)', async () => {
    repository.buscarIntentoPorClave.mockResolvedValue(intentoBase());
    global.fetch.mockRejectedValue(new Error('red caída'));

    await expect(ejecutarIntento('clave-1')).rejects.toThrow('red caída');

    expect(repository.marcarResultadoEnvio).toHaveBeenCalledWith(1, {
      estado: 'fallido',
      ultimoError: 'red caída',
    });
    expect(repository.marcarWamid).not.toHaveBeenCalled();
  });

  it('caída DESPUÉS de que Meta acepte: un segundo intento no vuelve a llamar a Meta (AC2, prueba mínima 2)', async () => {
    // Primer intento: Meta acepta (wamid se guarda), pero
    // marcarResultadoEnvio('enviado') nunca llega a completarse (simula el
    // crash local justo después de que Meta ya aceptó).
    repository.buscarIntentoPorClave.mockResolvedValueOnce(intentoBase());
    await ejecutarIntento('clave-1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(repository.marcarWamid).toHaveBeenCalledWith(1, 'wamid.123');

    // Segundo intento (el "worker" reintenta): la fila ya tiene wamid
    // pero seguimos simulando que el estado local no llegó a "enviado".
    repository.buscarIntentoPorClave.mockResolvedValueOnce(
      intentoBase({ wamid: 'wamid.123', estado: 'pendiente' }),
    );
    const resultado = await ejecutarIntento('clave-1');

    expect(global.fetch).toHaveBeenCalledTimes(1); // sigue en 1 — no se reenvió
    expect(resultado).toEqual({ enviado: true, yaEnviado: true, wamid: 'wamid.123' });
  });

  it('reintento sin respuesta duplicada: un intento ya "enviado" es no-op (prueba mínima 3)', async () => {
    repository.buscarIntentoPorClave.mockResolvedValue(
      intentoBase({ wamid: 'wamid.123', estado: 'enviado' }),
    );

    const resultado = await ejecutarIntento('clave-1');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(resultado).toEqual({ enviado: true, yaEnviado: true, wamid: 'wamid.123' });
  });

  it('reintento sin nueva llamada a Claude (prueba mínima 6)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    repository.buscarIntentoPorClave.mockResolvedValue(intentoBase());

    await ejecutarIntento('clave-1');
    await ejecutarIntento('clave-1');

    expect(spyClasificar).not.toHaveBeenCalled();
  });

  it('envío conversacional dentro de la ventana de 24h: se envía normal', async () => {
    repository.buscarIntentoPorClave.mockResolvedValue(intentoBase({ conversacion_id: 5 }));
    repository.estaVentanaServicioVencida.mockResolvedValue(false);

    const resultado = await ejecutarIntento('clave-1');

    expect(repository.estaVentanaServicioVencida).toHaveBeenCalledWith(5);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(resultado.enviado).toBe(true);
  });

  it('envío conversacional fuera de la ventana de 24h: no envía ni reintenta, marca ventana_servicio_expirada (AC5)', async () => {
    repository.buscarIntentoPorClave.mockResolvedValue(intentoBase({ conversacion_id: 5 }));
    repository.estaVentanaServicioVencida.mockResolvedValue(true);

    const resultado = await ejecutarIntento('clave-1');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(repository.marcarResultadoEnvio).toHaveBeenCalledWith(1, {
      estado: 'ventana_servicio_expirada',
    });
    expect(resultado).toEqual({ enviado: false, motivo: 'ventana_servicio_expirada' });
  });

  it('un envío de laboratorio (no conversacional) nunca comprueba la ventana de servicio', async () => {
    repository.buscarIntentoPorClave.mockResolvedValue(
      intentoBase({ tipo_envio: 'laboratorio', conversacion_id: null }),
    );

    await ejecutarIntento('clave-1');

    expect(repository.estaVentanaServicioVencida).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('alerta interna registrada por destinatario: capacidad inerte, directamente probable (AC7, prueba mínima 8)', async () => {
    repository.registrarIntentoEnvio.mockResolvedValue({
      intent: intentoBase({
        tipo_envio: 'alerta_interna',
        origen_funcional: 'alerta_interna',
        conversacion_id: null,
        destinatario_telefono: '5217711634578',
      }),
      esNuevo: true,
    });

    const { intent } = await registrarIntento({
      claveIdempotencia: 'alerta-1',
      tipoEnvio: 'alerta_interna',
      origenFuncional: 'alerta_interna',
      conversacionId: null,
      destinatarioTelefono: '5217711634578',
      payloadFuncional: { tipo: 'text', texto: 'emergencia reportada' },
      usaPlantilla: false,
    });

    expect(intent.tipo_envio).toBe('alerta_interna');
    expect(intent.destinatario_telefono).toBe('5217711634578');
    expect(intent.conversacion_id).toBeNull();
  });

  it('si Meta rechaza el envío, marca fallido y regresa el error sin lanzar', async () => {
    repository.buscarIntentoPorClave.mockResolvedValue(intentoBase());
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { code: 131030, message: 'Teléfono inválido.' } }),
    });

    const resultado = await ejecutarIntento('clave-1');

    expect(resultado).toEqual({
      enviado: false,
      error: 'Teléfono inválido.',
      errorCodigo: '131030',
    });
    expect(repository.marcarResultadoEnvio).toHaveBeenCalledWith(1, {
      estado: 'fallido',
      ultimoError: 'Teléfono inválido.',
    });
  });
});

describe('whatsapp.outbox.registrarEstadoMeta', () => {
  it('aplica el estado al outbox por wamid (AC3)', async () => {
    repository.aplicarEstadoMeta.mockResolvedValue(true);

    await registrarEstadoMeta({ wamid: 'wamid.123', estadoMeta: 'delivered' });

    expect(repository.aplicarEstadoMeta).toHaveBeenCalledWith('wamid.123', 'delivered');
  });

  it('si no hay ningún intento con ese wamid, no truena (solo se advierte)', async () => {
    repository.aplicarEstadoMeta.mockResolvedValue(false);

    await expect(
      registrarEstadoMeta({ wamid: 'wamid.desconocido', estadoMeta: 'sent' }),
    ).resolves.toBeUndefined();
  });
});
