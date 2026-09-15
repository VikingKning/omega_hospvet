// US WA 013 — seguimiento y expiración de flujos automáticos. Necesita
// Postgres real: FOR UPDATE SKIP LOCKED (idempotencia entre 2 workers,
// consideración técnica) y el reloj real para recordatorio_programado_en/
// flujo_expira_en — no se puede mockear. Las pruebas que solo verifican el
// CAMBIO DE ESTADO (AC2/AC3/AC4/AC5) llaman a
// repository.registrarMensajeYConversacion directamente (no vía el
// webhook): el envío inmediato que dispara el controller es fire-and-forget
// y no se puede esperar de forma determinista desde fuera — ese despacho
// (qué función de whatsapp.service.js se llama) ya se prueba en
// tests/unit/whatsapp.controller.test.js con mocks.
const db = require('../../src/config/database');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const menu = require('../../src/modules/whatsapp/whatsapp.menu');

const PHONE_NUMBER_ID = 'phone-integ-seguimiento-test';
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages: [{ id: 'wamid.seguimiento-fake' }] }),
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('mensajes_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('conversaciones_whatsapp').where('phone_number_id', PHONE_NUMBER_ID).del();
  await db.destroy();
});

async function crearConversacion(telefono, overrides = {}) {
  const ahora = new Date();
  const [conversacion] = await db('conversaciones_whatsapp')
    .insert({
      phone_number_id: PHONE_NUMBER_ID,
      telefono_normalizado: telefono,
      estado: 'esperando_menu',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
      recordatorio_programado_en: ahora,
      ...overrides,
    })
    .returning('*');
  return conversacion;
}

function enMs(minutos) {
  return minutos * 60 * 1000;
}

async function recargar(id) {
  return db('conversaciones_whatsapp').where({ id }).first();
}

describe('US WA 013 — envío del seguimiento (AC1)', () => {
  it('una conversación con el seguimiento vencido lo recibe (prueba mínima: exactamente después de 10 minutos)', async () => {
    const conversacion = await crearConversacion('525500010001', {
      recordatorio_programado_en: new Date(Date.now() - 1000),
    });

    const id = await service.procesarSiguienteSeguimientoPendiente();

    expect(id).toBe(conversacion.id);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opciones] = global.fetch.mock.calls[0];
    expect(JSON.parse(opciones.body).interactive.type).toBe('button');
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.recordatorio_enviado_en).not.toBeNull();
    expect(actualizada.flujo_expira_en).not.toBeNull();
    expect(actualizada.estado).toBe('esperando_menu');
  });

  it('una conversación cuyo seguimiento todavía no vence no se toca', async () => {
    await crearConversacion('525500010002', {
      recordatorio_programado_en: new Date(Date.now() + enMs(5)),
    });

    const id = await service.procesarSiguienteSeguimientoPendiente();

    expect(id).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('flujo_activo también recibe el seguimiento (AC1)', async () => {
    const conversacion = await crearConversacion('525500010003', {
      estado: 'flujo_activo',
      flujo_actual: 'laboratorio',
      paso_actual: 'paso_1',
      recordatorio_programado_en: new Date(Date.now() - 1000),
    });

    const id = await service.procesarSiguienteSeguimientoPendiente();

    expect(id).toBe(conversacion.id);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('dos workers reclamando el mismo seguimiento: solo uno lo envía (prueba mínima)', async () => {
    const conversacion = await crearConversacion('525500010004', {
      recordatorio_programado_en: new Date(Date.now() - 1000),
    });

    const [idA, idB] = await Promise.all([
      repository.reclamarConversacionParaSeguimiento(),
      repository.reclamarConversacionParaSeguimiento(),
    ]);

    const ganadores = [idA, idB].filter((r) => r && r.id === conversacion.id);
    expect(ganadores).toHaveLength(1);
  });

  it('un fallo de Meta no confirma el recordatorio y aplica backoff antes de reintentar', async () => {
    const conversacion = await crearConversacion('525500010099', {
      recordatorio_programado_en: new Date(Date.now() - 1000),
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('red caída'));

    await service.procesarSiguienteSeguimientoPendiente();

    const actualizada = await recargar(conversacion.id);
    expect(actualizada.recordatorio_enviado_en).toBeNull();
    expect(actualizada.recordatorio_reclamado_en).not.toBeNull();
    expect(actualizada.flujo_expira_en).toBeNull();

    // El drain loop no puede reclamar la misma fila otra vez en este ciclo.
    await expect(service.procesarSiguienteSeguimientoPendiente()).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('una conversación en estado distinto de esperando_menu/flujo_activo no recibe seguimiento (AC8)', async () => {
    await crearConversacion('525500010005', {
      estado: 'atencion_humana',
      recordatorio_programado_en: new Date(Date.now() - 1000),
    });

    const id = await service.procesarSiguienteSeguimientoPendiente();

    expect(id).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reinicio de PM2 antes del seguimiento: al reanudar el poll, lo sigue detectando (prueba mínima)', async () => {
    // El "reinicio" no necesita código especial de recuperación —
    // recordatorio_programado_en ya vive en Postgres desde antes de la
    // caída; llamar de nuevo a la MISMA función es exactamente lo que un
    // proceso reiniciado haría en su siguiente ciclo de poll.
    const conversacion = await crearConversacion('525500010006', {
      recordatorio_programado_en: new Date(Date.now() - 1000),
    });

    const idTrasReinicio = await service.procesarSiguienteSeguimientoPendiente();

    expect(idTrasReinicio).toBe(conversacion.id);
  });
});

describe('US WA 013 — cierre por inactividad (AC6/AC7/AC8)', () => {
  it('cierra una conversación cuyo seguimiento venció sin respuesta (prueba mínima: 20 minutos después)', async () => {
    const conversacion = await crearConversacion('525500010007', {
      recordatorio_enviado_en: new Date(Date.now() - enMs(20)),
      flujo_expira_en: new Date(Date.now() - 1000),
    });

    const id = await service.cerrarSiguienteConversacionInactiva();

    expect(id).toBe(conversacion.id);
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.estado).toBe('cerrada');
    expect(actualizada.cerrado_en).not.toBeNull();
  });

  it('no cierra si el seguimiento aún no venció', async () => {
    await crearConversacion('525500010008', {
      recordatorio_enviado_en: new Date(),
      flujo_expira_en: new Date(Date.now() + enMs(15)),
    });

    const id = await service.cerrarSiguienteConversacionInactiva();

    expect(id).toBeNull();
  });

  it('no cierra si nunca se envió el seguimiento, aunque haya pasado tiempo', async () => {
    await crearConversacion('525500010009', {
      recordatorio_programado_en: new Date(Date.now() - enMs(60)),
      recordatorio_enviado_en: null,
      flujo_expira_en: null,
    });

    const id = await service.cerrarSiguienteConversacionInactiva();

    expect(id).toBeNull();
  });

  it('una conversación en estado distinto de esperando_menu/flujo_activo no se cierra por esta historia (AC8)', async () => {
    await crearConversacion('525500010010', {
      estado: 'procesando',
      recordatorio_enviado_en: new Date(Date.now() - enMs(20)),
      flujo_expira_en: new Date(Date.now() - 1000),
    });

    const id = await service.cerrarSiguienteConversacionInactiva();

    expect(id).toBeNull();
  });

  it('dos workers cerrando la misma conversación: solo uno la cierra', async () => {
    const conversacion = await crearConversacion('525500010011', {
      recordatorio_enviado_en: new Date(Date.now() - enMs(20)),
      flujo_expira_en: new Date(Date.now() - 1000),
    });

    const [a, b] = await Promise.all([
      repository.cerrarConversacionPorInactividad(),
      repository.cerrarConversacionPorInactividad(),
    ]);

    expect([a, b].filter((id) => id === conversacion.id)).toHaveLength(1);
  });

  it('reinicio de PM2 antes del cierre: al reanudar el poll, lo sigue detectando (prueba mínima)', async () => {
    const conversacion = await crearConversacion('525500010012', {
      recordatorio_enviado_en: new Date(Date.now() - enMs(20)),
      flujo_expira_en: new Date(Date.now() - 1000),
    });

    const idTrasReinicio = await service.cerrarSiguienteConversacionInactiva();

    expect(idTrasReinicio).toBe(conversacion.id);
  });

  it('un mensaje después del cierre por inactividad crea una nueva conversación (AC7, prueba mínima)', async () => {
    const telefono = '525500010013';
    const conversacion = await crearConversacion(telefono, {
      recordatorio_enviado_en: new Date(Date.now() - enMs(20)),
      flujo_expira_en: new Date(Date.now() - 1000),
    });
    await service.cerrarSiguienteConversacionInactiva();

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.segui-tras-cierre',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'hola de nuevo',
      mediaId: null,
      recibidoEn: new Date(),
    });

    expect(resultado.conversacionId).not.toBe(conversacion.id);
    const nueva = await recargar(resultado.conversacionId);
    expect(nueva.estado).toBe('acumulando');
  });
});

describe('US WA 013 — respuesta del tutor al seguimiento (AC2/AC3/AC4/AC5)', () => {
  async function enviarMensaje(telefono, overrides, { tipoMensaje, contenido, wamid }) {
    const conversacion = await crearConversacion(telefono, {
      recordatorio_enviado_en: new Date(),
      ...overrides,
    });
    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: wamid,
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje,
      contenido,
      mediaId: null,
      recibidoEn: new Date(),
    });
    return { conversacion, resultado };
  }

  it('botón "Continuar": conserva el flujo y reinicia el control de inactividad (AC2)', async () => {
    const { conversacion, resultado } = await enviarMensaje(
      '525500010101',
      { estado: 'flujo_activo', flujo_actual: 'laboratorio', paso_actual: 'paso_1' },
      {
        tipoMensaje: 'interactive_button_reply',
        contenido: menu.RESPUESTA_CONTINUAR,
        wamid: 'wamid.segui-continuar',
      },
    );

    expect(resultado.seguimientoAccion).toBe('continuar');
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.flujo_actual).toBe('laboratorio');
    expect(actualizada.paso_actual).toBe('paso_1');
    expect(actualizada.recordatorio_enviado_en).toBeNull();
    expect(actualizada.flujo_expira_en).toBeNull();
    expect(actualizada.recordatorio_programado_en.getTime()).toBeGreaterThan(Date.now());
  });

  it('botón "Volver al menú": cancela el flujo anterior (AC3)', async () => {
    const { conversacion, resultado } = await enviarMensaje(
      '525500010102',
      { estado: 'flujo_activo', flujo_actual: 'laboratorio', paso_actual: 'paso_1' },
      {
        tipoMensaje: 'interactive_button_reply',
        contenido: menu.RESPUESTA_VOLVER_MENU,
        wamid: 'wamid.segui-volver',
      },
    );

    expect(resultado.seguimientoAccion).toBe('volver_menu');
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.estado).toBe('esperando_menu');
    expect(actualizada.flujo_actual).toBeNull();
    expect(actualizada.paso_actual).toBeNull();
  });

  it('texto libre después del seguimiento: se considera continuación, reinicia inactividad (AC4, prueba mínima)', async () => {
    const { conversacion, resultado } = await enviarMensaje(
      '525500010103',
      {},
      {
        tipoMensaje: 'text',
        contenido: 'quiero agendar una cita',
        wamid: 'wamid.segui-texto-libre',
      },
    );

    expect(resultado.seguimientoAccion).toBe('continuar_texto');
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.estado).toBe('esperando_menu');
    expect(actualizada.recordatorio_enviado_en).toBeNull();
    expect(actualizada.flujo_expira_en).toBeNull();
  });

  it('un botón que no es Continuar ni Volver al menú: no avanza el flujo (AC5, prueba mínima: respuesta inválida en un paso cerrado)', async () => {
    const { conversacion, resultado } = await enviarMensaje(
      '525500010104',
      { estado: 'flujo_activo', flujo_actual: 'laboratorio', paso_actual: 'paso_1' },
      {
        tipoMensaje: 'interactive_button_reply',
        contenido: 'opcion_extraviada',
        wamid: 'wamid.segui-invalido',
      },
    );

    expect(resultado.seguimientoAccion).toBe('invalido');
    const actualizada = await recargar(conversacion.id);
    // AC5: "sin avanzar el flujo" — estado/flujo/paso quedan exactamente igual.
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.flujo_actual).toBe('laboratorio');
    expect(actualizada.paso_actual).toBe('paso_1');
    // Pero SÍ es una interacción del tutor: reinicia el control de inactividad.
    expect(actualizada.recordatorio_enviado_en).toBeNull();
  });

  it('un comando de menú explícito gana sobre un seguimiento pendiente', async () => {
    const { resultado } = await enviarMensaje(
      '525500010105',
      { estado: 'flujo_activo', flujo_actual: 'laboratorio', paso_actual: 'paso_1' },
      { tipoMensaje: 'text', contenido: 'menu', wamid: 'wamid.segui-comando-menu' },
    );

    expect(resultado.disparaMenuInmediato).toBe(true);
    expect(resultado.seguimientoAccion).toBeNull();
  });

  it('sin un seguimiento pendiente (recordatorio_enviado_en nulo), un texto normal no dispara ninguna acción de seguimiento', async () => {
    const { resultado } = await enviarMensaje(
      '525500010106',
      { recordatorio_enviado_en: null },
      {
        tipoMensaje: 'text',
        contenido: 'una pregunta cualquiera',
        wamid: 'wamid.segui-sin-pendiente',
      },
    );

    expect(resultado.seguimientoAccion).toBeNull();
  });

  it('en atencion_humana, ni siquiera con recordatorio_enviado_en, se evalúa como seguimiento (AC8, estado fuera de alcance)', async () => {
    const { resultado } = await enviarMensaje(
      '525500010107',
      { estado: 'atencion_humana', recordatorio_enviado_en: new Date() },
      { tipoMensaje: 'text', contenido: 'hola', wamid: 'wamid.segui-atencion-humana' },
    );

    expect(resultado.seguimientoAccion).toBeNull();
  });
});
