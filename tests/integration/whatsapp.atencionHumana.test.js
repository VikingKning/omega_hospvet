// US WA 017 — gestión unificada de atención humana. Necesita Postgres
// real: FOR UPDATE SKIP LOCKED (AC22), el reloj real para
// atencion_humana_desde/hasta (AC6/AC21) y el índice único parcial de
// conversaciones_whatsapp (AC16/AC17) — nada de esto se puede mockear.
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const atencionHumanaRepository = require('../../src/modules/whatsapp/whatsapp.atencionHumana.repository');
const atencionHumanaService = require('../../src/modules/whatsapp/whatsapp.atencionHumana.service');

const PHONE_NUMBER_ID = 'phone-integ-atencionhumana-test';
const originalFetch = global.fetch;
let contadorWamidFake = 0;

beforeEach(() => {
  // A propósito NUNCA se reinicia entre pruebas (bug real ya encontrado
  // varias veces en esta sesión): outbox_whatsapp.wamid tiene un índice
  // único parcial real, y las filas de un test anterior siguen vivas hasta
  // el afterAll — reiniciar el contador produciría el mismo wamid falso en
  // 2 pruebas distintas y chocaría contra esa restricción.
  global.fetch = jest.fn().mockImplementation(async () => {
    contadorWamidFake += 1;
    return {
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: `wamid.ah-fake-${contadorWamidFake}` }] }),
    };
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
});

afterEach(async () => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  // procesarSiguienteSolicitudPendiente()/reclamarSolicitudPendiente() son
  // deliberadamente GLOBALES (FIFO por solicitado_en, sin filtrar por
  // conversación) — mismo criterio que el resto de los workers de este
  // módulo. Una prueba que registra una solicitud pero nunca la procesa
  // (ej. las de AC1/AC2, que solo verifican el registro) la deja
  // 'pendiente' para siempre, y una prueba POSTERIOR que llama al worker
  // esperando procesar SU PROPIA solicitud terminaría procesando esa otra
  // en su lugar. Se limpia después de cada prueba (nunca antes de sus
  // propios asserts) para que cada una siguiente arranque con la cola
  // vacía.
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  if (conversacionIds.length) {
    await db('solicitudes_atencion_humana')
      .whereIn('conversacion_id', conversacionIds)
      .whereIn('estado', ['pendiente', 'fallida_reintentable', 'enviando'])
      .del();
  }
});

afterAll(async () => {
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  await db('solicitudes_atencion_humana').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('mensajes_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('conversaciones_whatsapp').where('phone_number_id', PHONE_NUMBER_ID).del();
  await db.destroy();
});

let contadorTelefono = 0;
function generarTelefono() {
  contadorTelefono += 1;
  return `52550002${String(contadorTelefono).padStart(4, '0')}`;
}

async function crearConversacion(telefono, overrides = {}) {
  const ahora = new Date();
  const [conversacion] = await db('conversaciones_whatsapp')
    .insert({
      phone_number_id: PHONE_NUMBER_ID,
      telefono_normalizado: telefono,
      estado: 'esperando_menu',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
      ...overrides,
    })
    .returning('*');
  return conversacion;
}

async function recargarConversacion(id) {
  return db('conversaciones_whatsapp').where({ id }).first();
}

let contadorClave = 0;
function claveIdempotencia(origen) {
  contadorClave += 1;
  return `${origen}:conv-${contadorClave}:evento-${contadorClave}`;
}

describe.each(['emergencia', 'recepcion'])(
  'US WA 017 — solicitud de atención humana, origen "%s" (AC1/AC23)',
  (origen) => {
    it('AC1: registra la solicitud con sus referencias y prepara la intención de envío (US WA 015)', async () => {
      const telefono = generarTelefono();
      const conversacion = await crearConversacion(telefono);

      const solicitud = await atencionHumanaService.solicitarAtencionHumana({
        conversacionId: conversacion.id,
        origen,
        prioridad: 'alta',
        claveIdempotencia: claveIdempotencia(origen),
        referenciasFuncionales: { alertaId: 42 },
        destinatarioTelefono: telefono,
      });

      expect(solicitud.origen).toBe(origen);
      expect(solicitud.estado).toBe('pendiente');
      expect(solicitud.outbox_id).not.toBeNull();

      const intent = await db('outbox_whatsapp').where({ intent_id: solicitud.outbox_id }).first();
      expect(intent.tipo_envio).toBe('conversacional');
      expect(intent.origen_funcional).toBe('atencion_humana');
      expect(intent.conversacion_id).toBe(conversacion.id);
    });

    it('AC2: una solicitud repetida con la MISMA clave de idempotencia reutiliza el registro, sin crear otro intento de envío', async () => {
      const telefono = generarTelefono();
      const conversacion = await crearConversacion(telefono);
      const clave = claveIdempotencia(origen);

      const primera = await atencionHumanaService.solicitarAtencionHumana({
        conversacionId: conversacion.id,
        origen,
        claveIdempotencia: clave,
        destinatarioTelefono: telefono,
      });
      const segunda = await atencionHumanaService.solicitarAtencionHumana({
        conversacionId: conversacion.id,
        origen,
        claveIdempotencia: clave,
        destinatarioTelefono: telefono,
      });

      expect(segunda.id).toBe(primera.id);
      const total = await db('solicitudes_atencion_humana')
        .where({ clave_idempotencia: clave })
        .count('id as total')
        .first();
      expect(Number(total.total)).toBe(1);
      const intentos = await db('outbox_whatsapp')
        .where({ conversacion_id: conversacion.id })
        .count('intent_id as total')
        .first();
      expect(Number(intentos.total)).toBe(1);
    });

    it('AC6: al confirmarse el envío, la conversación pasa a atencion_humana con el vencimiento calculado a 5 horas exactas (AC21: WHATSAPP_ATENCION_HUMANA_HORAS)', async () => {
      const telefono = generarTelefono();
      const conversacion = await crearConversacion(telefono);
      await atencionHumanaService.solicitarAtencionHumana({
        conversacionId: conversacion.id,
        origen,
        claveIdempotencia: claveIdempotencia(origen),
        destinatarioTelefono: telefono,
      });

      const resultado = await atencionHumanaService.procesarSiguienteSolicitudPendiente();

      expect(resultado.resultado).toBe('enviada');
      const actualizada = await recargarConversacion(conversacion.id);
      expect(actualizada.estado).toBe('atencion_humana');
      expect(actualizada.atencion_humana_desde).not.toBeNull();
      expect(actualizada.origen_atencion_humana).toBe('solicitud_transferencia');
      const desdeMs = new Date(actualizada.atencion_humana_desde).getTime();
      const hastaMs = new Date(actualizada.atencion_humana_hasta).getTime();
      const horasReales = (hastaMs - desdeMs) / (60 * 60 * 1000);
      expect(horasReales).toBeCloseTo(env.whatsapp.atencionHumanaHoras, 3);

      const solicitud = await db('solicitudes_atencion_humana')
        .where({ conversacion_id: conversacion.id })
        .first();
      expect(solicitud.estado).toBe('finalizada');
      expect(solicitud.enviado_en).not.toBeNull();
    });
  },
);

describe('US WA 017 — mensaje genérico visible y sin datos internos (AC3/AC4)', () => {
  it('el texto enviado a Meta es visible, no contiene prioridad/origen/categorías ni detalles de auditoría', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono);
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: conversacion.id,
      origen: 'emergencia',
      prioridad: 'critica',
      claveIdempotencia: claveIdempotencia('emergencia'),
      referenciasFuncionales: { alertaId: 999 },
      destinatarioTelefono: telefono,
    });

    await atencionHumanaService.procesarSiguienteSolicitudPendiente();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opciones] = global.fetch.mock.calls[0];
    const body = JSON.parse(opciones.body);
    expect(body.type).toBe('text');
    expect(body.text.body).toBe(atencionHumanaService.TEXTO_TRANSFERENCIA);
    const textoPlano = body.text.body.toLowerCase();
    expect(textoPlano).not.toContain('emergencia');
    expect(textoPlano).not.toContain('critica');
    expect(textoPlano).not.toContain('999');
    expect(textoPlano).not.toContain('prioridad');
  });
});

describe('US WA 017 — envío previo y orden (AC5)', () => {
  it('no envía el aviso de transferencia hasta que el envío previo se confirme enviado', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono);

    const { intent: previo } =
      await require('../../src/modules/whatsapp/whatsapp.outbox').registrarIntento({
        claveIdempotencia: `previo:${conversacion.id}`,
        tipoEnvio: 'conversacional',
        origenFuncional: 'atencion_humana',
        conversacionId: conversacion.id,
        destinatarioTelefono: telefono,
        payloadFuncional: {
          tipo: 'text',
          destinatarioTelefono: telefono,
          texto: 'Aviso previo de emergencia.',
        },
        usaPlantilla: false,
      });

    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: conversacion.id,
      origen: 'emergencia',
      claveIdempotencia: claveIdempotencia('emergencia'),
      envioPrevioId: previo.intent_id,
      destinatarioTelefono: telefono,
    });

    // El previo todavía no se ha enviado -> la transferencia no debe salir.
    const intento1 = await atencionHumanaService.procesarSiguienteSolicitudPendiente();
    expect(intento1).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    let actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).not.toBe('atencion_humana');

    // Se confirma el previo -> ahora sí procede, y respeta el orden.
    await require('../../src/modules/whatsapp/whatsapp.outbox').ejecutarIntento(
      `previo:${conversacion.id}`,
    );
    const intento2 = await atencionHumanaService.procesarSiguienteSolicitudPendiente();
    expect(intento2.resultado).toBe('enviada');
    actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('atencion_humana');

    // Verifica el orden real de los 2 fetch: el previo antes que la transferencia.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, opcionesPrevio] = global.fetch.mock.calls[0];
    const [, opcionesTransferencia] = global.fetch.mock.calls[1];
    expect(JSON.parse(opcionesPrevio.body).text.body).toBe('Aviso previo de emergencia.');
    expect(JSON.parse(opcionesTransferencia.body).text.body).toBe(
      atencionHumanaService.TEXTO_TRANSFERENCIA,
    );
  });
});

describe('US WA 017 — fallo y reintento del envío (AC19)', () => {
  it('si Meta rechaza el envío, la solicitud queda fallida_reintentable y NO se establece atencion_humana_desde/hasta', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono);
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: conversacion.id,
      origen: 'emergencia',
      claveIdempotencia: claveIdempotencia('emergencia'),
      destinatarioTelefono: telefono,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'Meta caído', code: 1 } }),
    });

    const resultado = await atencionHumanaService.procesarSiguienteSolicitudPendiente();

    expect(resultado.resultado).toBe('fallida_reintentable');
    const solicitud = await db('solicitudes_atencion_humana')
      .where({ conversacion_id: conversacion.id })
      .first();
    expect(solicitud.estado).toBe('fallida_reintentable');
    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).not.toBe('atencion_humana');
    expect(actualizada.atencion_humana_desde).toBeNull();
    expect(actualizada.atencion_humana_hasta).toBeNull();

    // El backoff evita que el drain loop reclame la misma fila en caliente.
    await expect(atencionHumanaService.procesarSiguienteSolicitudPendiente()).resolves.toBeNull();

    // Reintento idempotente: la MISMA clave de outbox, nunca duplica el intento.
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.ah-reintento' }] }),
    }));
    await db('solicitudes_atencion_humana')
      .where({ id: solicitud.id })
      .update({ reintentar_despues_de: new Date(Date.now() - 1000) });
    const reintento = await atencionHumanaService.procesarSiguienteSolicitudPendiente();
    expect(reintento.resultado).toBe('enviada');
    const intentos = await db('outbox_whatsapp')
      .where({ conversacion_id: conversacion.id })
      .count('intent_id as total')
      .first();
    expect(Number(intentos.total)).toBe(1); // el mismo intento, nunca uno nuevo.
  });
});

describe('US WA 017 — prioridad y ausencia de bloqueo de cabecera', () => {
  it('una emergencia crítica se reclama antes que una solicitud normal más antigua', async () => {
    const normal = await crearConversacion(generarTelefono());
    const critica = await crearConversacion(generarTelefono());
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: normal.id,
      origen: 'recepcion',
      prioridad: 'normal',
      claveIdempotencia: claveIdempotencia('recepcion'),
      destinatarioTelefono: normal.telefono_normalizado,
      ahora: new Date(Date.now() - 60_000),
    });
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: critica.id,
      origen: 'emergencia',
      prioridad: 'critica',
      claveIdempotencia: claveIdempotencia('emergencia'),
      destinatarioTelefono: critica.telefono_normalizado,
    });

    const reclamada = await atencionHumanaRepository.reclamarSolicitudPendiente();
    expect(reclamada.conversacion_id).toBe(critica.id);
  });
});

describe('US WA 017 — silencio desde la transferencia pendiente (AC20)', () => {
  it('un mensaje adicional conserva solo metadata y no entra a agrupación', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono);
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: conversacion.id,
      origen: 'recepcion',
      prioridad: 'normal',
      claveIdempotencia: claveIdempotencia('recepcion'),
      destinatarioTelefono: telefono,
    });

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: `wamid.transferencia-pendiente-${telefono}`,
      telefonoOrigen: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: '¿ya me atienden? datos clínicos privados',
      recibidoEn: new Date(),
    });

    expect(resultado.rutaResuelta).toBeNull();
    const mensaje = await db('mensajes_whatsapp').where({ id: resultado.id }).first();
    expect(mensaje.estado_procesamiento).toBe('ignorado_atencion_humana');
    expect(mensaje.mensaje_recibido).toBeNull();
    expect(mensaje.media_id).toBeNull();
    expect(mensaje.group_id).toBeNull();
  });
});

describe('US WA 017 — dos workers concurrentes (AC22)', () => {
  it('activar: solo uno de los dos gana la misma solicitud', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono);
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: conversacion.id,
      origen: 'emergencia',
      claveIdempotencia: claveIdempotencia('emergencia'),
      destinatarioTelefono: telefono,
    });

    const [r1, r2] = await Promise.all([
      atencionHumanaService.procesarSiguienteSolicitudPendiente(),
      atencionHumanaService.procesarSiguienteSolicitudPendiente(),
    ]);
    const resultados = [r1, r2].filter(Boolean);
    expect(resultados).toHaveLength(1); // el otro vio 0 filas (SKIP LOCKED) y regresó null.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cerrar por vencimiento: solo uno de dos workers cierra la misma conversación', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono, {
      estado: 'atencion_humana',
      atencion_humana_desde: new Date(Date.now() - 6 * 60 * 60 * 1000),
      atencion_humana_hasta: new Date(Date.now() - 1000),
      origen_atencion_humana: 'solicitud_transferencia',
    });

    const [id1, id2] = await Promise.all([
      atencionHumanaRepository.reclamarAtencionHumanaVencida(),
      atencionHumanaRepository.reclamarAtencionHumanaVencida(),
    ]);
    const ganadores = [id1, id2].filter(Boolean);
    expect(ganadores).toEqual([conversacion.id]);

    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('cerrada');
    expect(actualizada.motivo_cierre).toBe('vencimiento_atencion_humana');
  });
});

describe('US WA 017 — silencio durante atención humana (AC7-AC9/AC14/AC20)', () => {
  async function conversacionEnAtencionHumana(telefono, overrides = {}) {
    return crearConversacion(telefono, {
      estado: 'atencion_humana',
      atencion_humana_desde: new Date(),
      atencion_humana_hasta: new Date(Date.now() + 5 * 60 * 60 * 1000),
      origen_atencion_humana: 'solicitud_transferencia',
      ...overrides,
    });
  }

  it('AC7/AC8/AC9: un mensaje ordinario solo persiste metadatos — sin texto/caption/media_id/group_id', async () => {
    const telefono = generarTelefono();
    const conversacion = await conversacionEnAtencionHumana(telefono);

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-ordinario-1',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'image',
      contenido: 'un caption cualquiera',
      mediaId: 'media-real-123',
      mimeType: 'image/jpeg',
      recibidoEn: new Date(),
    });

    expect(resultado.conversacionId).toBe(conversacion.id);
    const mensaje = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: 'wamid.ah-ordinario-1' })
      .first();
    expect(mensaje.mensaje_recibido).toBeNull();
    expect(mensaje.media_id).toBeNull();
    expect(mensaje.mime_type).toBeNull();
    expect(mensaje.group_id).toBeNull();
    expect(mensaje.estado_procesamiento).toBe('ignorado_atencion_humana');
    expect(mensaje.conversacion_id).toBe(conversacion.id);

    // AC7: no llama a Meta, no responde nada.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('AC14: un mensaje ordinario NUNCA extiende ni toca atencion_humana_hasta', async () => {
    const telefono = generarTelefono();
    const hastaOriginal = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const conversacion = await conversacionEnAtencionHumana(telefono, {
      atencion_humana_hasta: hastaOriginal,
    });

    await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-noextiende',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'sigo esperando una respuesta',
      recibidoEn: new Date(),
    });

    const actualizada = await recargarConversacion(conversacion.id);
    expect(new Date(actualizada.atencion_humana_hasta).getTime()).toBe(hastaOriginal.getTime());
    expect(actualizada.estado).toBe('atencion_humana');
  });

  it('AC10: una reentrega del mismo whatsapp_message_id no crea otro registro ni activa el bot', async () => {
    const telefono = generarTelefono();
    await conversacionEnAtencionHumana(telefono);

    const primera = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-reentrega',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'hola',
      recibidoEn: new Date(),
    });
    const segunda = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-reentrega',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'hola',
      recibidoEn: new Date(),
    });

    expect(primera.esNuevo).toBe(true);
    expect(segunda.esNuevo).toBe(false);
    const total = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: 'wamid.ah-reentrega' })
      .count('id as total')
      .first();
    expect(Number(total.total)).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('AC20: una solicitud pendiente de envío también silencia mensajes nuevos, aunque la conversación no esté en atencion_humana todavía', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono, { estado: 'esperando_menu' });
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: conversacion.id,
      origen: 'emergencia',
      claveIdempotencia: claveIdempotencia('emergencia'),
      destinatarioTelefono: telefono,
    });
    // Todavía no corre el worker: la solicitud sigue 'pendiente' y la
    // conversación sigue 'esperando_menu' — un mensaje nuevo del tutor no
    // debe disparar ninguna respuesta automática nueva sobre esa selección.
    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-pendiente-1',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'interactive_list_reply',
      contenido: 'MENU_EMERGENCIA',
      recibidoEn: new Date(),
    });
    // Con la conversación todavía 'esperando_menu' (no atencion_humana), el
    // pipeline normal SÍ la procesa — la "evitación de nuevas respuestas
    // automáticas" de AC20 es responsabilidad del ORIGEN que llamó a
    // solicitarAtencionHumana (dejar de seguir despachando), no de este
    // mecanismo genérico; una vez que la transferencia se confirma (AC6),
    // el silencio real ya lo garantiza el estado atencion_humana.
    expect(resultado.conversacionId).toBe(conversacion.id);
  });
});

describe('US WA 017 — reactivación por comando del tutor (AC11-AC14/AC18)', () => {
  async function conversacionEnAtencionHumana(telefono) {
    return crearConversacion(telefono, {
      estado: 'atencion_humana',
      atencion_humana_desde: new Date(),
      atencion_humana_hasta: new Date(Date.now() + 5 * 60 * 60 * 1000),
      origen_atencion_humana: 'solicitud_transferencia',
    });
  }

  it.each(['menu', 'menú', 'Menú', 'MENU'])(
    'AC11: el comando "%s" (con y sin acento) reactiva el bot',
    async (comando) => {
      const telefono = generarTelefono();
      const vieja = await conversacionEnAtencionHumana(telefono);

      const resultado = await repository.registrarMensajeYConversacion({
        whatsappMessageId: `wamid.ah-comando-${comando}`,
        telefonoOrigen: `521${telefono.slice(2)}`,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoNormalizado: telefono,
        tipoMensaje: 'text',
        contenido: comando,
        recibidoEn: new Date(),
      });

      expect(resultado.disparaMenuInmediato).toBe(true);
      expect(resultado.conversacionId).not.toBe(vieja.id);
      const nueva = await recargarConversacion(resultado.conversacionId);
      expect(nueva.estado).toBe('esperando_menu');
    },
  );

  it('AC11: el comando "inicio" también reactiva el bot', async () => {
    const telefono = generarTelefono();
    await conversacionEnAtencionHumana(telefono);

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-inicio',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'inicio',
      recibidoEn: new Date(),
    });

    expect(resultado.disparaMenuInmediato).toBe(true);
  });

  it('AC12: cierra la conversación vieja con motivo_cierre=solicitud_tutor y crea una nueva interacción', async () => {
    const telefono = generarTelefono();
    const vieja = await conversacionEnAtencionHumana(telefono);

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-cierre',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'menu',
      recibidoEn: new Date(),
    });

    const viejaActualizada = await recargarConversacion(vieja.id);
    expect(viejaActualizada.estado).toBe('cerrada');
    expect(viejaActualizada.motivo_cierre).toBe('solicitud_tutor');
    const nueva = await recargarConversacion(resultado.conversacionId);
    expect(nueva.id).not.toBe(vieja.id);
    expect(nueva.estado).toBe('esperando_menu');
  });

  it('AC13: el mensaje del comando conserva solo metadatos, con resultado comando_reactivacion_bot — nunca el texto original', async () => {
    const telefono = generarTelefono();
    await conversacionEnAtencionHumana(telefono);

    await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-metadatos-comando',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'menu',
      recibidoEn: new Date(),
    });

    const mensaje = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: 'wamid.ah-metadatos-comando' })
      .first();
    expect(mensaje.mensaje_recibido).toBeNull();
    expect(mensaje.estado_procesamiento).toBe('comando_reactivacion_bot');
  });

  it('AC18: la nueva interacción no incorpora los mensajes ignorados de la atención humana anterior', async () => {
    const telefono = generarTelefono();
    const vieja = await conversacionEnAtencionHumana(telefono);

    // Un mensaje ordinario ignorado ANTES de la reactivación.
    await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-previo-ignorado',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'sigo aquí',
      recibidoEn: new Date(),
    });

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-reactiva-tras-ignorado',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'menu',
      recibidoEn: new Date(),
    });

    const mensajeIgnorado = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: 'wamid.ah-previo-ignorado' })
      .first();
    // Sigue asociado a la conversación VIEJA (ya cerrada), nunca a la nueva.
    expect(mensajeIgnorado.conversacion_id).toBe(vieja.id);
    expect(mensajeIgnorado.conversacion_id).not.toBe(resultado.conversacionId);
    expect(mensajeIgnorado.group_id).toBeNull();
  });
});

describe('US WA 017 — vencimiento detectado en el procesamiento entrante (AC15-AC18)', () => {
  it('AC15: el worker cierra una conversación cuyo atencion_humana_hasta ya venció', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono, {
      estado: 'atencion_humana',
      atencion_humana_desde: new Date(Date.now() - 6 * 60 * 60 * 1000),
      atencion_humana_hasta: new Date(Date.now() - 1000),
      origen_atencion_humana: 'solicitud_transferencia',
    });

    const id = await atencionHumanaService.cerrarSiguienteAtencionHumanaVencida();

    expect(id).toBe(conversacion.id);
    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('cerrada');
    expect(actualizada.motivo_cierre).toBe('vencimiento_atencion_humana');
  });

  it('AC16/AC17: un mensaje recibido después del vencimiento (antes de que corra el worker) cierra la vieja y crea una nueva en acumulando con la ventana normal de 10s', async () => {
    const telefono = generarTelefono();
    const vieja = await crearConversacion(telefono, {
      estado: 'atencion_humana',
      atencion_humana_desde: new Date(Date.now() - 6 * 60 * 60 * 1000),
      atencion_humana_hasta: new Date(Date.now() - 1000), // ya venció, el worker aún no corrió.
      origen_atencion_humana: 'solicitud_transferencia',
    });

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: 'wamid.ah-tras-vencimiento',
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'text',
      contenido: 'hola, sigo con una duda',
      recibidoEn: new Date(),
    });

    const viejaActualizada = await recargarConversacion(vieja.id);
    expect(viejaActualizada.estado).toBe('cerrada');
    expect(viejaActualizada.motivo_cierre).toBe('vencimiento_atencion_humana');

    const nueva = await recargarConversacion(resultado.conversacionId);
    expect(nueva.id).not.toBe(vieja.id);
    expect(nueva.estado).toBe('acumulando'); // AC16: ventana normal, no directo a esperando_menu.
    expect(nueva.procesar_despues_de).not.toBeNull();
    const ventanaMs =
      new Date(nueva.procesar_despues_de).getTime() - new Date(nueva.primer_fragmento_en).getTime();
    expect(ventanaMs).toBe(env.whatsapp.agrupacionSegundos * 1000); // AC17.

    // AC18: el mensaje SÍ se guarda completo esta vez (ya es la conversación nueva).
    const mensaje = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: 'wamid.ah-tras-vencimiento' })
      .first();
    expect(mensaje.mensaje_recibido).toBe('hola, sigo con una duda');
    expect(mensaje.conversacion_id).toBe(nueva.id);
  });

  it('AC21: el vencimiento persistido en BD no depende de memoria del proceso (simula un reinicio: se relee de la BD tal cual)', async () => {
    const telefono = generarTelefono();
    const hastaOriginal = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const conversacion = await crearConversacion(telefono, {
      estado: 'atencion_humana',
      atencion_humana_desde: new Date(),
      atencion_humana_hasta: hastaOriginal,
      origen_atencion_humana: 'solicitud_transferencia',
    });

    // "Reinicio de PM2": no hay estado en memoria que perder — solo se
    // vuelve a leer de la BD, que es la única fuente de verdad.
    const releida = await recargarConversacion(conversacion.id);
    expect(new Date(releida.atencion_humana_hasta).getTime()).toBe(hastaOriginal.getTime());

    // Y el worker de vencimiento tampoco la toca porque de verdad no ha vencido.
    const cerrada = await atencionHumanaRepository.reclamarAtencionHumanaVencida();
    expect(cerrada).not.toBe(conversacion.id);
  });
});

describe('US WA 017 — mensaje manual de Omega (smb_message_echoes, AC25-AC31/AC35/AC36)', () => {
  it('AC26: sin conversación abierta, crea una directo en atencion_humana con origen_atencion_humana=iniciada_por_omega', async () => {
    const telefono = generarTelefono();

    const resultado = await atencionHumanaService.registrarEchoManual({
      whatsappMessageId: 'wamid.eco-nueva',
      telefonoTutor: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      tipoMensaje: 'text',
      recibidoEn: new Date(),
    });

    expect(resultado.transicion).toBe('creada_atencion_humana');
    const conversacion = await recargarConversacion(resultado.conversacionId);
    expect(conversacion.estado).toBe('atencion_humana');
    expect(conversacion.origen_atencion_humana).toBe('iniciada_por_omega');
    expect(conversacion.atencion_humana_desde).not.toBeNull();
  });

  it('AC27/AC28: con una conversación automatizada abierta, la transiciona conservando su historial y calcula el vencimiento con la fecha del echo', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono, { estado: 'esperando_menu' });
    const fechaEcho = new Date(Date.now() - 60000); // "la fecha que Meta reportó" — distinta de "ahora".

    const resultado = await atencionHumanaService.registrarEchoManual({
      whatsappMessageId: 'wamid.eco-transicion',
      telefonoTutor: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      tipoMensaje: 'text',
      recibidoEn: fechaEcho,
    });

    expect(resultado.transicion).toBe('transicionada_atencion_humana');
    expect(resultado.conversacionId).toBe(conversacion.id); // conserva la MISMA fila (historial).
    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('atencion_humana');
    expect(new Date(actualizada.atencion_humana_desde).getTime()).toBe(fechaEcho.getTime());
  });

  it('AC29: no envía el aviso genérico de transferencia — solo transiciona el estado', async () => {
    const telefono = generarTelefono();
    await crearConversacion(telefono, { estado: 'esperando_menu' });

    await atencionHumanaService.registrarEchoManual({
      whatsappMessageId: 'wamid.eco-sin-aviso',
      telefonoTutor: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      tipoMensaje: 'text',
      recibidoEn: new Date(),
    });

    expect(global.fetch).not.toHaveBeenCalled();
    const solicitudes = await db('solicitudes_atencion_humana')
      .whereIn(
        'conversacion_id',
        await db('conversaciones_whatsapp')
          .where({ phone_number_id: PHONE_NUMBER_ID, telefono_normalizado: telefono })
          .pluck('id'),
      )
      .count('id as total')
      .first();
    expect(Number(solicitudes.total)).toBe(0);
  });

  it('AC31: un segundo echo mientras YA está en atencion_humana no reinicia ni extiende la ventana', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono, {
      estado: 'atencion_humana',
      atencion_humana_desde: new Date(Date.now() - 60 * 60 * 1000),
      atencion_humana_hasta: new Date(Date.now() + 4 * 60 * 60 * 1000),
      origen_atencion_humana: 'iniciada_por_omega',
    });
    const hastaOriginal = conversacion.atencion_humana_hasta;

    const resultado = await atencionHumanaService.registrarEchoManual({
      whatsappMessageId: 'wamid.eco-segundo',
      telefonoTutor: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      tipoMensaje: 'text',
      recibidoEn: new Date(),
    });

    expect(resultado.transicion).toBe('ya_en_atencion_humana');
    const actualizada = await recargarConversacion(conversacion.id);
    expect(new Date(actualizada.atencion_humana_hasta).getTime()).toBe(
      new Date(hastaOriginal).getTime(),
    );
  });

  it('AC35: reentregar el mismo smb_message_echoes no crea otra conversación ni reinicia la ventana', async () => {
    const telefono = generarTelefono();
    const wamid = 'wamid.eco-reentrega';

    const primero = await atencionHumanaService.registrarEchoManual({
      whatsappMessageId: wamid,
      telefonoTutor: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      tipoMensaje: 'text',
      recibidoEn: new Date(),
    });
    const antes = await recargarConversacion(primero.conversacionId);

    const segundo = await atencionHumanaService.registrarEchoManual({
      whatsappMessageId: wamid,
      telefonoTutor: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      tipoMensaje: 'text',
      recibidoEn: new Date(),
    });

    expect(segundo.transicion).toBe('reentrega');
    const despues = await recargarConversacion(primero.conversacionId);
    expect(new Date(despues.atencion_humana_hasta).getTime()).toBe(
      new Date(antes.atencion_humana_hasta).getTime(),
    );
    const totalConversaciones = await db('conversaciones_whatsapp')
      .where({ phone_number_id: PHONE_NUMBER_ID, telefono_normalizado: telefono })
      .count('id as total')
      .first();
    expect(Number(totalConversaciones.total)).toBe(1);
  });

  it('AC36: al transicionar por un echo, cancela SOLO las respuestas conversacionales automáticas pendientes — nunca laboratorio u otros transaccionales', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacion(telefono, { estado: 'esperando_menu' });
    const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');

    const { intent: pendienteConversacional } = await outbox.registrarIntento({
      claveIdempotencia: `conv-pendiente:${conversacion.id}`,
      tipoEnvio: 'conversacional',
      origenFuncional: 'respuesta_automatica',
      conversacionId: conversacion.id,
      destinatarioTelefono: telefono,
      payloadFuncional: {
        tipo: 'text',
        destinatarioTelefono: telefono,
        texto: 'respuesta del bot',
      },
      usaPlantilla: false,
    });
    const { intent: laboratorioPendiente } = await outbox.registrarIntento({
      claveIdempotencia: `lab-pendiente:${conversacion.id}`,
      tipoEnvio: 'laboratorio',
      origenFuncional: 'laboratorio',
      conversacionId: conversacion.id,
      destinatarioTelefono: telefono,
      payloadFuncional: {
        tipo: 'text',
        destinatarioTelefono: telefono,
        texto: 'resultados listos',
      },
      usaPlantilla: true,
    });

    await atencionHumanaService.registrarEchoManual({
      whatsappMessageId: 'wamid.eco-cancela',
      telefonoTutor: telefono,
      phoneNumberId: PHONE_NUMBER_ID,
      tipoMensaje: 'text',
      recibidoEn: new Date(),
    });

    const conversacionalCancelado = await db('outbox_whatsapp')
      .where({ intent_id: pendienteConversacional.intent_id })
      .first();
    expect(conversacionalCancelado.estado).toBe('cancelado');

    const laboratorioIntacto = await db('outbox_whatsapp')
      .where({ intent_id: laboratorioPendiente.intent_id })
      .first();
    expect(laboratorioIntacto.estado).toBe('pendiente');
  });
});
