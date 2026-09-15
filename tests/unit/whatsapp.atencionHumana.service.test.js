// US WA 017 — mecanismo unificado de atención humana (capa de servicio).
// Se mockea whatsapp.atencionHumana.repository, whatsapp.outbox y
// config/database porque estas pruebas son sobre la ORQUESTACIÓN
// (qué se llama, en qué orden, con qué datos) — la idempotencia real de
// Postgres (FOR UPDATE SKIP LOCKED, transacciones, el índice único de
// clave_idempotencia) vive en tests/integration/whatsapp.atencionHumana.test.js.
jest.mock('../../src/modules/whatsapp/whatsapp.atencionHumana.repository');
jest.mock('../../src/modules/whatsapp/whatsapp.outbox');
jest.mock('../../src/config/database');
const db = require('../../src/config/database');
const repository = require('../../src/modules/whatsapp/whatsapp.atencionHumana.repository');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');
const {
  solicitarAtencionHumana,
  procesarSiguienteSolicitudPendiente,
  cerrarSiguienteAtencionHumanaVencida,
  registrarEchoManual,
  AtencionHumanaValidationError,
  TEXTO_TRANSFERENCIA,
} = require('../../src/modules/whatsapp/whatsapp.atencionHumana.service');

beforeEach(() => {
  jest.clearAllMocks();
  db.transaction = jest.fn((cb) => cb('trx-fake'));
});

describe('whatsapp.atencionHumana.service.solicitarAtencionHumana', () => {
  const paramsBase = {
    conversacionId: 10,
    origen: 'emergencia',
    prioridad: 'alta',
    claveIdempotencia: 'clave-1',
    destinatarioTelefono: '525500000000',
  };

  it('rechaza un origen fuera de la whitelist controlada (AC23)', async () => {
    await expect(solicitarAtencionHumana({ ...paramsBase, origen: 'otro' })).rejects.toThrow(
      AtencionHumanaValidationError,
    );
    expect(repository.solicitarAtencionHumana).not.toHaveBeenCalled();
  });

  it.each(['conversacionId', 'claveIdempotencia', 'destinatarioTelefono'])(
    'exige %s',
    async (campoFaltante) => {
      const params = { ...paramsBase };
      delete params[campoFaltante];

      await expect(solicitarAtencionHumana(params)).rejects.toThrow(AtencionHumanaValidationError);
      expect(repository.solicitarAtencionHumana).not.toHaveBeenCalled();
    },
  );

  it('acepta el origen "recepcion" (AC23)', async () => {
    repository.solicitarAtencionHumana.mockResolvedValue({
      solicitud: { id: 5 },
      esNueva: true,
    });
    outbox.registrarIntento.mockResolvedValue({ intent: { intent_id: 99 } });

    await solicitarAtencionHumana({ ...paramsBase, origen: 'recepcion' });

    expect(repository.solicitarAtencionHumana).toHaveBeenCalledWith(
      expect.objectContaining({ origen: 'recepcion' }),
    );
  });

  it('una solicitud nueva registra de inmediato la intención de envío genérica (AC1/AC3)', async () => {
    repository.solicitarAtencionHumana.mockResolvedValue({
      solicitud: { id: 5, conversacion_id: 10 },
      esNueva: true,
    });
    outbox.registrarIntento.mockResolvedValue({ intent: { intent_id: 99 } });

    const resultado = await solicitarAtencionHumana(paramsBase);

    expect(outbox.registrarIntento).toHaveBeenCalledWith(
      expect.objectContaining({
        claveIdempotencia: 'atencion_humana:5:transferencia',
        tipoEnvio: 'conversacional',
        origenFuncional: 'atencion_humana',
        conversacionId: 10,
        destinatarioTelefono: '525500000000',
        usaPlantilla: false,
        payloadFuncional: {
          tipo: 'text',
          destinatarioTelefono: '525500000000',
          texto: TEXTO_TRANSFERENCIA,
        },
      }),
      'trx-fake',
    );
    expect(repository.marcarSolicitudOutbox).toHaveBeenCalledWith(5, 99, 'trx-fake');
    expect(resultado).toEqual(expect.objectContaining({ id: 5, outbox_id: 99 }));
  });

  it('el texto genérico nunca menciona información clínica ni interna (AC3/AC4)', () => {
    const textoBajo = TEXTO_TRANSFERENCIA.toLowerCase();
    expect(textoBajo).not.toContain('emergencia');
    expect(textoBajo).not.toContain('recepcion');
    expect(textoBajo).not.toContain('prioridad');
  });

  it('un `trx` opcional (US WA 009 AC23) se propaga a repository.solicitarAtencionHumana/outbox.registrarIntento/marcarSolicitudOutbox', async () => {
    repository.solicitarAtencionHumana.mockResolvedValue({
      solicitud: { id: 5, conversacion_id: 10 },
      esNueva: true,
    });
    outbox.registrarIntento.mockResolvedValue({ intent: { intent_id: 99 } });
    const trxFake = { esUnaTransaccion: true };

    await solicitarAtencionHumana({ ...paramsBase, trx: trxFake });

    expect(repository.solicitarAtencionHumana).toHaveBeenCalledWith(
      expect.objectContaining({ trx: trxFake }),
    );
    expect(outbox.registrarIntento).toHaveBeenCalledWith(expect.any(Object), trxFake);
    expect(repository.marcarSolicitudOutbox).toHaveBeenCalledWith(5, 99, trxFake);
  });

  it('una solicitud duplicada (esNueva:false) reutiliza el registro sin volver a registrar el envío (AC2)', async () => {
    repository.solicitarAtencionHumana.mockResolvedValue({
      solicitud: { id: 5, conversacion_id: 10 },
      esNueva: false,
    });

    const resultado = await solicitarAtencionHumana(paramsBase);

    expect(outbox.registrarIntento).not.toHaveBeenCalled();
    expect(repository.marcarSolicitudOutbox).not.toHaveBeenCalled();
    expect(resultado).toEqual({ id: 5, conversacion_id: 10 });
  });
});

describe('whatsapp.atencionHumana.service.procesarSiguienteSolicitudPendiente', () => {
  it('sin ninguna solicitud reclamable, regresa null sin tocar el outbox (AC5)', async () => {
    repository.reclamarSolicitudPendiente.mockResolvedValue(null);

    const resultado = await procesarSiguienteSolicitudPendiente();

    expect(resultado).toBeNull();
    expect(outbox.ejecutarIntento).not.toHaveBeenCalled();
  });

  it('un envío exitoso confirma la transferencia con la fecha de la confirmación de Meta (AC6)', async () => {
    repository.reclamarSolicitudPendiente.mockResolvedValue({ id: 7, conversacion_id: 10 });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.abc' });
    repository.confirmarTransferenciaEnviada.mockResolvedValue(true);

    const resultado = await procesarSiguienteSolicitudPendiente();

    expect(outbox.ejecutarIntento).toHaveBeenCalledWith('atencion_humana:7:transferencia');
    expect(repository.confirmarTransferenciaEnviada).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ conversacionId: 10 }),
    );
    expect(repository.marcarSolicitudFallidaReintentable).not.toHaveBeenCalled();
    expect(resultado).toEqual({ id: 7, resultado: 'enviada' });
  });

  it('si Meta rechaza el envío, la solicitud queda reintentable sin tocar atencion_humana_desde/hasta (AC19)', async () => {
    repository.reclamarSolicitudPendiente.mockResolvedValue({ id: 7, conversacion_id: 10 });
    outbox.ejecutarIntento.mockResolvedValue({
      enviado: false,
      error: 'rechazado',
      errorCodigo: 131009,
    });

    const resultado = await procesarSiguienteSolicitudPendiente();

    expect(repository.marcarSolicitudFallidaReintentable).toHaveBeenCalledWith(7);
    expect(repository.confirmarTransferenciaEnviada).not.toHaveBeenCalled();
    expect(resultado).toEqual({ id: 7, resultado: 'fallida_reintentable' });
  });

  it('si ejecutarIntento truena, la solicitud queda reintentable (fallo inesperado)', async () => {
    repository.reclamarSolicitudPendiente.mockResolvedValue({ id: 7, conversacion_id: 10 });
    outbox.ejecutarIntento.mockRejectedValue(new Error('boom'));

    const resultado = await procesarSiguienteSolicitudPendiente();

    expect(repository.marcarSolicitudFallidaReintentable).toHaveBeenCalledWith(7);
    expect(resultado).toEqual({ id: 7, resultado: 'fallida_reintentable' });
  });

  it('si la conversación ya no admite la transición, el mensaje se deja auditado como enviado sin reintentar', async () => {
    repository.reclamarSolicitudPendiente.mockResolvedValue({ id: 7, conversacion_id: 10 });
    outbox.ejecutarIntento.mockResolvedValue({ enviado: true, wamid: 'wamid.abc' });
    repository.confirmarTransferenciaEnviada.mockResolvedValue(false);

    const resultado = await procesarSiguienteSolicitudPendiente();

    expect(repository.marcarSolicitudFallidaReintentable).not.toHaveBeenCalled();
    expect(resultado).toEqual({ id: 7, resultado: 'enviada' });
  });
});

describe('whatsapp.atencionHumana.service.cerrarSiguienteAtencionHumanaVencida', () => {
  it('delega directamente en repository.reclamarAtencionHumanaVencida (AC15)', async () => {
    repository.reclamarAtencionHumanaVencida.mockResolvedValue({ id: 3 });

    const resultado = await cerrarSiguienteAtencionHumanaVencida();

    expect(repository.reclamarAtencionHumanaVencida).toHaveBeenCalledWith();
    expect(resultado).toEqual({ id: 3 });
  });
});

describe('whatsapp.atencionHumana.service.registrarEchoManual', () => {
  it('envuelve la llamada en su propia transacción, independiente del flujo de mensajes entrantes (AC25)', async () => {
    repository.registrarEchoManual.mockResolvedValue({ transicion: 'creada' });

    const resultado = await registrarEchoManual({
      whatsappMessageId: 'wamid.eco-1',
      telefonoTutor: '525500000000',
      phoneNumberId: 'phone-1',
      tipoMensaje: 'text',
      recibidoEn: new Date('2026-09-14T10:00:00Z'),
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(repository.registrarEchoManual).toHaveBeenCalledWith(
      'trx-fake',
      expect.objectContaining({
        whatsappMessageId: 'wamid.eco-1',
        telefonoTutor: '525500000000',
        phoneNumberId: 'phone-1',
        tipoMensaje: 'text',
      }),
    );
    expect(resultado).toEqual({ transicion: 'creada' });
  });
});
