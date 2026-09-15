// US WA 005 — procesamiento de opciones del menú. Necesita Postgres real:
// el índice único de whatsapp_message_id (AC8, idempotencia) y el reloj
// real para procesar_despues_de (AC10/AC13) — no se puede mockear.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const menu = require('../../src/modules/whatsapp/whatsapp.menu');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion-menu-selecciones';
const VERIFY_TOKEN = 'verify-token-de-integracion-menu-selecciones';

const WAMID_PREFIX = 'wamid.menusel-';
const PHONE_NUMBER_ID = 'phone-integ-menusel-test';

const originalFetch = global.fetch;
let contadorWamidFake = 0;

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

beforeEach(() => {
  // outbox_whatsapp.wamid tiene un índice único real — un wamid fijo
  // compartido entre pruebas chocaría en cuanto más de una prueba de este
  // archivo de verdad completa un envío.
  global.fetch = jest.fn().mockImplementation(async () => {
    contadorWamidFake += 1;
    return {
      ok: true,
      json: () =>
        Promise.resolve({ messages: [{ id: `wamid.menusel-fake-${contadorWamidFake}` }] }),
    };
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  // US WA 009: el texto libre tras el menú (AC10) ahora se clasifica de
  // verdad al vencer su ventana — este archivo prueba la mecánica de
  // selección de menú (US WA 005), no la clasificación en sí.
  jest
    .spyOn(claude, 'clasificarMensaje')
    .mockResolvedValue({ etiqueta: null, tokensEntrada: 0, tokensSalida: 0 });
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  await db('conversaciones_whatsapp')
    .whereIn('id', conversacionIds)
    .update({ grupo_medio_pendiente_id: null });
  // US WA 009: grupos_whatsapp.intento_envio_id ahora referencia
  // outbox_whatsapp — hay que soltar esa referencia ANTES de borrar
  // outbox_whatsapp, o la FK truena.
  await db('grupos_whatsapp')
    .whereIn('conversacion_id', conversacionIds)
    .update({ intento_envio_id: null });
  await db('emergencias_confirmadas').whereIn('conversacion_id', conversacionIds).del();
  await db('solicitudes_atencion_humana').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('mensajes_whatsapp').where('whatsapp_message_id', 'like', `${WAMID_PREFIX}%`).del();
  await db('grupos_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('conversaciones_whatsapp').where('phone_number_id', PHONE_NUMBER_ID).del();
  await db.destroy();
});

function firmar(rawBodyString) {
  const hash = crypto.createHmac('sha256', APP_SECRET).update(rawBodyString).digest('hex');
  return `sha256=${hash}`;
}

function ahoraEpoch(offsetSegundos = 0) {
  return String(Math.floor(Date.now() / 1000) + offsetSegundos);
}

function payloadMensaje(wamid, from, mensaje, timestamp) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [{ id: wamid, from, timestamp: timestamp ?? ahoraEpoch(), ...mensaje }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

async function postMensaje(wamid, from, mensaje, timestamp) {
  const rawBody = JSON.stringify(payloadMensaje(wamid, from, mensaje, timestamp));
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

const textoMsg = (texto) => ({ type: 'text', text: { body: texto } });
const listReplyMsg = (id, title) => ({
  type: 'interactive',
  interactive: { type: 'list_reply', list_reply: { id, title } },
});
const buttonReplyMsg = (id, title) => ({
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title } },
});

// Genera un teléfono normalizado válido (52 + 10 dígitos) — nunca a mano
// con concatenaciones de longitudes de string, que no siempre producen 10
// dígitos y rompen el round-trip por normalizarNumeroSalida (521... -> 52...).
function generarTelefono() {
  const digitos = String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  return `52${digitos}`;
}

async function crearConversacionEsperandoMenu(telefono, overrides = {}) {
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

describe('US WA 005 — selección válida del menú (AC2-AC7, AC13)', () => {
  // MENU_RESULTADOS_LAB y MENU_EMERGENCIA quedan fuera de este it.each a
  // propósito: desde US WA 007/US WA 009 son las ÚNICAS rutas que además
  // arrancan un flujo propio (consulta de laboratorio / solicitud de
  // descripción de emergencia) — cada una tiene su propia prueba dedicada
  // más abajo (la de laboratorio en whatsapp.laboratorioConsulta.test.js).
  it.each([
    [menu.MENU_AGENDAR_CONSULTA, 'agendar_consulta'],
    [menu.MENU_AGENDAR_ESTETICA, 'agendar_estetica'],
    [menu.MENU_RECEPCION, 'recepcion'],
  ])(
    '%s se resuelve a la ruta "%s", conserva la conversación abierta y no llama a Claude (prueba mínima: cada id válido)',
    async (idMenu, rutaEsperada) => {
      const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
      const telefono = generarTelefono();
      const conversacion = await crearConversacionEsperandoMenu(telefono);

      const wamid = `${WAMID_PREFIX}${idMenu}`;
      const res = await postMensaje(
        wamid,
        `521${telefono.slice(2)}`,
        listReplyMsg(idMenu, 'Título cualquiera'),
      );

      expect(res.status).toBe(200);
      const mensaje = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid }).first();
      expect(mensaje.categoria_clasificacion).toBe(rutaEsperada);
      expect(mensaje.estado_procesamiento).toBe('procesado');
      const actualizada = await recargarConversacion(conversacion.id);
      expect(actualizada.estado).toBe('esperando_menu'); // AC13: conserva la conversación abierta.
      expect(spyClasificar).not.toHaveBeenCalled(); // AC2
      expect(global.fetch).not.toHaveBeenCalled(); // ninguna ruta se ejecuta desde esta historia.
    },
  );

  it('MENU_RESULTADOS_LAB se resuelve a la ruta "resultados_laboratorio" Y arranca el flujo de consulta (US WA 007 AC1)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono);

    // Llamada directa al repository (no vía el webhook): el arranque del
    // flujo de laboratorio dispara un envío fire-and-forget en el
    // controller — mismo criterio de determinismo ya usado en
    // whatsapp.seguimiento.test.js/whatsapp.medios.test.js.
    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: `${WAMID_PREFIX}lab-arranque-${telefono}`,
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'interactive_list_reply',
      contenido: menu.MENU_RESULTADOS_LAB,
      mediaId: null,
      mimeType: null,
      tituloInteractivo: 'Resultado de laboratorio',
      recibidoEn: new Date(),
    });

    expect(resultado.rutaResuelta).toBe('resultados_laboratorio');
    expect(resultado.labAccion).toBe('iniciar');
    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.flujo_actual).toBe('consulta_laboratorio');
    expect(actualizada.paso_actual).toBe('confirmando_telefono');
    expect(spyClasificar).not.toHaveBeenCalled();
  });

  it('MENU_EMERGENCIA envía de inmediato la solicitud de descripción y arranca el flujo de emergencia (US WA 009 AC1/AC2)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono);

    // Llamada directa al repository + service (no vía el webhook): el
    // envío de la solicitud de emergencia es fire-and-forget en el
    // controller — mismo criterio de determinismo ya usado por la prueba
    // de MENU_RESULTADOS_LAB de arriba (whatsapp.seguimiento.test.js/
    // whatsapp.medios.test.js).
    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: `${WAMID_PREFIX}emergencia-arranque-${telefono}`,
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'interactive_list_reply',
      contenido: menu.MENU_EMERGENCIA,
      mediaId: null,
      mimeType: null,
      tituloInteractivo: 'Emergencia',
      recibidoEn: new Date(),
    });

    expect(resultado.rutaResuelta).toBe('emergencia');
    expect(resultado.disparaSolicitudEmergencia).toBe(true);
    let actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('esperando_menu'); // AC2/AC3: no transiciona hasta confirmar el envío.

    const enviado = await service.enviarSolicitudEmergencia({
      conversacionId: conversacion.id,
      telefono,
      claveBase: `mensaje:${resultado.id}`,
    });

    expect(enviado).toBe(true);
    actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.flujo_actual).toBe('emergencia');
    expect(actualizada.paso_actual).toBe('esperando_descripcion');
    expect(actualizada.procesar_despues_de).toBeNull(); // AC4: arranca con el primer fragmento, no aquí.
    expect(spyClasificar).not.toHaveBeenCalled(); // AC1: sin llamar a Claude.
    const [, opciones] = global.fetch.mock.calls[0];
    expect(JSON.parse(opciones.body).text.body).toBe(
      'Por favor, descríbenos cuál es tu emergencia.',
    );
  });

  it('list reply y button reply se procesan igual (prueba mínima)', async () => {
    const telA = generarTelefono();
    const telB = generarTelefono();
    await crearConversacionEsperandoMenu(telA);
    await crearConversacionEsperandoMenu(telB);

    await postMensaje(
      `${WAMID_PREFIX}list-${telA}`,
      `521${telA.slice(2)}`,
      listReplyMsg(menu.MENU_EMERGENCIA),
    );
    await postMensaje(
      `${WAMID_PREFIX}button-${telB}`,
      `521${telB.slice(2)}`,
      buttonReplyMsg(menu.MENU_EMERGENCIA),
    );

    const msgList = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: `${WAMID_PREFIX}list-${telA}` })
      .first();
    const msgButton = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: `${WAMID_PREFIX}button-${telB}` })
      .first();
    expect(msgList.categoria_clasificacion).toBe('emergencia');
    expect(msgButton.categoria_clasificacion).toBe('emergencia');
  });

  it('ausencia de llamadas a Claude en todas las selecciones válidas (prueba mínima)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telefono = generarTelefono();
    await crearConversacionEsperandoMenu(telefono);

    await postMensaje(
      `${WAMID_PREFIX}sinclaude-${telefono}`,
      `521${telefono.slice(2)}`,
      listReplyMsg(menu.MENU_RECEPCION),
    );

    expect(spyClasificar).not.toHaveBeenCalled();
  });

  it('MENU_RECEPCION crea una sola solicitud WA017 con origen/prioridad y clave estable (WA010)', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono);
    const wamid = `${WAMID_PREFIX}recepcion-wa010-${telefono}`;

    await postMensaje(wamid, `521${telefono.slice(2)}`, listReplyMsg(menu.MENU_RECEPCION));
    await postMensaje(wamid, `521${telefono.slice(2)}`, listReplyMsg(menu.MENU_RECEPCION));

    const solicitudes = await db('solicitudes_atencion_humana').where({
      conversacion_id: conversacion.id,
      origen: 'recepcion',
    });
    expect(solicitudes).toHaveLength(1);
    expect(solicitudes[0].prioridad).toBe('normal');
    expect(solicitudes[0].clave_idempotencia).toBe(`recepcion:mensaje:${wamid}`);
    expect(solicitudes[0].referencias_funcionales).toEqual(
      expect.objectContaining({
        whatsappMessageId: wamid,
        groupId: expect.any(Number),
      }),
    );
    const mensaje = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid }).first();
    expect(mensaje.group_id).toBe(solicitudes[0].referencias_funcionales.groupId);
    expect(mensaje.tokens_entrada).toBe(0);
    expect(mensaje.tokens_salida).toBe(0);
  });
});

describe('US WA 005 — selección inválida (AC9)', () => {
  it('un id desconocido o manipulado avisa y muestra un menú nuevo, sin resolver ninguna ruta (prueba mínima)', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono);

    const wamid = `${WAMID_PREFIX}garbage-${telefono}`;
    await postMensaje(
      wamid,
      `521${telefono.slice(2)}`,
      listReplyMsg('MENU_INVENTADO', 'Algo raro'),
    );

    const mensaje = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid }).first();
    expect(mensaje.categoria_clasificacion).toBeNull();
    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('esperando_menu');
  });

  it('un id de menú válido pero de un menú ya vencido también avisa y muestra un menú nuevo (prueba mínima)', async () => {
    const telefono = generarTelefono();
    // La conversación ya avanzó a flujo_activo (ej. WA014) — el menú de
    // este id ya no es el vigente.
    const conversacion = await crearConversacionEsperandoMenu(telefono, {
      estado: 'flujo_activo',
      flujo_actual: 'explicacion_medio',
      paso_actual: 'esperando_descripcion',
    });

    // Llamada directa al repository (no vía el webhook): el aviso + menú
    // nuevo es fire-and-forget en el controller — probarlo de forma
    // determinista significa no competir con ese mismo disparo en segundo
    // plano (mismo criterio ya usado en whatsapp.seguimiento.test.js).
    const wamid = `${WAMID_PREFIX}vencido-${telefono}`;
    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: wamid,
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'interactive_list_reply',
      contenido: menu.MENU_EMERGENCIA,
      mediaId: null,
      mimeType: null,
      tituloInteractivo: 'Emergencia',
      recibidoEn: new Date(),
    });

    expect(resultado.seleccionInvalida).toBe(true);
    expect(resultado.rutaResuelta).toBeNull();

    const enviado = await service.enviarSeleccionInvalida({
      conversacionId: conversacion.id,
      telefono,
      mensajeId: resultado.id,
    });
    expect(enviado).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('esperando_menu'); // confirmarMenuEnviado la recupera.
  });

  it('un medio no interpretable durante atención humana nunca se evalúa como selección de menú', async () => {
    const telefono = generarTelefono();
    await crearConversacionEsperandoMenu(telefono, { estado: 'atencion_humana' });

    const wamid = `${WAMID_PREFIX}humana-${telefono}`;
    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: wamid,
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'interactive_list_reply',
      contenido: menu.MENU_EMERGENCIA,
      mediaId: null,
      mimeType: null,
      tituloInteractivo: 'Emergencia',
      recibidoEn: new Date(),
    });

    expect(resultado.seleccionInvalida).toBe(false);
    expect(resultado.rutaResuelta).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('US WA 005 — idempotencia (AC8, prueba mínima: selección duplicada)', () => {
  it('una selección reentregada por Meta no vuelve a resolver la ruta ni a ejecutar nada', async () => {
    const telefono = generarTelefono();
    await crearConversacionEsperandoMenu(telefono);
    const wamid = `${WAMID_PREFIX}dup-${telefono}`;

    await postMensaje(wamid, `521${telefono.slice(2)}`, listReplyMsg(menu.MENU_AGENDAR_CONSULTA));
    await postMensaje(wamid, `521${telefono.slice(2)}`, listReplyMsg(menu.MENU_AGENDAR_CONSULTA));

    const filas = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid });
    expect(filas).toHaveLength(1);
    expect(filas[0].categoria_clasificacion).toBe('agendar_consulta');
  });
});

describe('US WA 005 — texto libre después del menú (AC10)', () => {
  it('texto libre en esperando_menu no se trata como selección inválida — se agrupa normalmente (prueba mínima)', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono);

    await postMensaje(
      `${WAMID_PREFIX}libre-${telefono}`,
      `521${telefono.slice(2)}`,
      textoMsg('quiero saber precios'),
    );

    let actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('esperando_menu');
    expect(actualizada.procesar_despues_de).not.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled(); // nunca se avisa de "opción inválida" por texto libre.

    await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({ procesar_despues_de: new Date(Date.now() - 1000) });
    const grupo = await service.procesarSiguienteConversacionVencida();

    expect(grupo.texto_consolidado).toBe('quiero saber precios');
    // US WA 003: agrupación normal, sin enrutar desde ESTA historia — pero
    // desde US WA 009 sí hay un consumidor real (mockeado a
    // sin_coincidencia arriba) en vez de quedar 'no_resuelto'.
    expect(grupo.resultado).toBe('clasificado_normal');
  });

  it('cinco fragmentos de texto después del menú se agrupan en un solo grupo (prueba mínima)', async () => {
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono);

    for (const [i, texto] of ['uno', 'dos', 'tres', 'cuatro', 'cinco'].entries()) {
      await postMensaje(
        `${WAMID_PREFIX}cinco-${telefono}-${i}`,
        `521${telefono.slice(2)}`,
        textoMsg(texto),
        ahoraEpoch(i),
      );
    }

    await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({ procesar_despues_de: new Date(Date.now() - 1000) });
    const grupo = await service.procesarSiguienteConversacionVencida();

    expect(grupo.texto_consolidado).toBe('uno\ndos\ntres\ncuatro\ncinco');
    const mensajes = await db('mensajes_whatsapp').where({ group_id: grupo.groupId });
    expect(mensajes).toHaveLength(5);
  });
});

// AC11/AC12: un paso cerrado con botones + validación de valores permitidos
// ya existe end-to-end en el mecanismo de seguimiento de US WA 013
// (Continuar/Volver al menú) — no se construye un mecanismo genérico nuevo
// sin un segundo llamador real (ver resumen de la historia). Estas pruebas
// confirman que ese mecanismo YA satisface el requisito general de AC11/AC12.
describe('US WA 005 — paso cerrado: respuesta válida e inválida (AC11/AC12, vía el mecanismo de US WA 013)', () => {
  it('una respuesta válida (Continuar) conserva el flujo sin llamar a Claude (prueba mínima)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono, {
      estado: 'flujo_activo',
      flujo_actual: 'explicacion_medio',
      paso_actual: 'esperando_descripcion',
      recordatorio_enviado_en: new Date(),
    });

    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: `${WAMID_PREFIX}pasocerrado-valido-${telefono}`,
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'interactive_button_reply',
      contenido: menu.RESPUESTA_CONTINUAR,
      tituloInteractivo: 'Continuar',
      recibidoEn: new Date(),
    });

    const actualizada = await recargarConversacion(conversacion.id);
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.flujo_actual).toBe('explicacion_medio');
    expect(spyClasificar).not.toHaveBeenCalled();
    await service.reanudarFlujoPendiente({
      conversacionId: conversacion.id,
      telefono,
      mensajeId: resultado.id,
      flujoActual: resultado.flujoActualResultante,
      pasoActual: resultado.pasoActualResultante,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('una respuesta inválida en un paso cerrado no avanza el flujo y repite las opciones sin llamar a Claude (prueba mínima: repetición de opciones sin llamada a Claude)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telefono = generarTelefono();
    const conversacion = await crearConversacionEsperandoMenu(telefono, {
      estado: 'flujo_activo',
      flujo_actual: 'explicacion_medio',
      paso_actual: 'esperando_descripcion',
      recordatorio_enviado_en: new Date(),
    });

    // Llamada directa al repository (no vía el webhook): el disparo de
    // reenviarSeguimiento es fire-and-forget en el controller — probarlo de
    // forma determinista significa no competir con ese mismo disparo en
    // segundo plano (mismo criterio ya usado en whatsapp.seguimiento.test.js).
    const wamid = `${WAMID_PREFIX}pasocerrado-invalido-${telefono}`;
    const resultado = await repository.registrarMensajeYConversacion({
      whatsappMessageId: wamid,
      telefonoOrigen: `521${telefono.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telefono,
      tipoMensaje: 'interactive_button_reply',
      contenido: 'opcion_inventada',
      mediaId: null,
      mimeType: null,
      tituloInteractivo: 'Rara',
      recibidoEn: new Date(),
    });

    expect(resultado.seguimientoAccion).toBe('invalido');
    const actualizada = await recargarConversacion(conversacion.id);
    // AC12: sin avanzar el flujo.
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.flujo_actual).toBe('explicacion_medio');
    expect(spyClasificar).not.toHaveBeenCalled();

    global.fetch.mockClear();
    const enviado = await service.reenviarSeguimiento({
      conversacionId: conversacion.id,
      telefono,
      mensajeId: resultado.id,
    });
    expect(enviado.enviado).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opciones] = global.fetch.mock.calls[0];
    expect(JSON.parse(opciones.body).interactive.type).toBe('button'); // repite los botones, AC12.
  });
});
