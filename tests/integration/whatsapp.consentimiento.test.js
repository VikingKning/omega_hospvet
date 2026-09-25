// LFPDPPP — gate de consentimiento antes de cualquier procesamiento
// automático de WhatsApp. Mismo patrón de firma/envío que
// whatsapp.agrupacion.test.js. El aviso se sube a Meta como media (igual
// que los resultados de laboratorio, ver whatsapp.envios.js#subirMedia) —
// no depende de ninguna URL pública, así que basta con mockear
// configuracion.service y distinguir la llamada a mediaUrl() de la de
// messagesUrl() en el fetch global.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const configuracionService = require('../../src/modules/configuracion/configuracion.service');
const tutoresRepository = require('../../src/modules/tutores/tutores.repository');
const menu = require('../../src/modules/whatsapp/whatsapp.menu');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion-lfpdppp';
const VERIFY_TOKEN = 'verify-token-de-integracion-lfpdppp';

const WAMID_PREFIX = 'wamid.lfpdppp-';
const PHONE_NUMBER_ID = 'phone-integ-lfpdppp-test';

const AVISO_MOCK = {
  archivo: 'aviso-privacidad-test.pdf',
  version: '2026-09-19',
  nombreArchivo: 'Aviso de Privacidad Omega.pdf',
};

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

let contadorWamidFake = 0;
let contadorMediaFake = 0;
beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (String(url).includes('/fake/media')) {
      contadorMediaFake += 1;
      return { ok: true, json: () => Promise.resolve({ id: `media-fake-${contadorMediaFake}` }) };
    }
    contadorWamidFake += 1;
    return {
      ok: true,
      json: () =>
        Promise.resolve({ messages: [{ id: `wamid.lfpdppp-fake-${contadorWamidFake}` }] }),
    };
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'mediaUrl').mockReturnValue('https://graph.facebook.com/fake/media');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  jest.spyOn(whatsappConfig, 'bearerHeader').mockReturnValue({ Authorization: 'Bearer fake' });
  jest
    .spyOn(claude, 'clasificarMensaje')
    .mockResolvedValue({ etiqueta: null, tokensEntrada: 0, tokensSalida: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  const alertaIds = await db('alertas_atencion_whatsapp')
    .whereIn('conversacion_id', conversacionIds)
    .pluck('id');
  await db('intentos_alerta_whatsapp').whereIn('alerta_id', alertaIds).del();
  await db('destinatarios_alerta_whatsapp').whereIn('alerta_id', alertaIds).del();
  await db('alertas_atencion_whatsapp').whereIn('id', alertaIds).del();
  await db('solicitudes_atencion_humana').whereIn('conversacion_id', conversacionIds).del();
  // mensajes_whatsapp y grupos_whatsapp deben borrarse ANTES que
  // outbox_whatsapp: grupos_whatsapp.intento_envio_id referencia
  // outbox_whatsapp, así que borrarlo primero rompería esa FK (se vio
  // pasar en vivo 2026-09-21, con el worker de agrupación formando un
  // grupo real para el mensaje que se retoma al aceptar el aviso).
  await db('mensajes_whatsapp').where('whatsapp_message_id', 'like', `${WAMID_PREFIX}%`).del();
  await db('grupos_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('consentimiento_lfpdppp').where('telefono', 'like', '5255008800%').del();
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

function payloadBase(wamid, from, timestamp, mensajeExtra) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [{ id: wamid, from, timestamp, ...mensajeExtra }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

async function postTexto(wamid, from, texto, timestamp = ahoraEpoch()) {
  const rawBody = payloadBase(wamid, from, timestamp, { type: 'text', text: { body: texto } });
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

async function postBoton(wamid, from, botonId, tituloBoton, timestamp = ahoraEpoch()) {
  const rawBody = payloadBase(wamid, from, timestamp, {
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: botonId, title: tituloBoton } },
  });
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

async function postListReply(wamid, from, listId, tituloOpcion, timestamp = ahoraEpoch()) {
  const rawBody = payloadBase(wamid, from, timestamp, {
    type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: listId, title: tituloOpcion } },
  });
  return request(app)
    .post('/webhooks/whatsapp')
    .type('json')
    .set('X-Hub-Signature-256', firmar(rawBody))
    .send(rawBody);
}

function buscarConversacion(telefonoNormalizado) {
  return db('conversaciones_whatsapp')
    .where({ phone_number_id: PHONE_NUMBER_ID, telefono_normalizado: telefonoNormalizado })
    .orderBy('id', 'desc');
}

function ultimoMensaje(whatsappMessageId) {
  return db('mensajes_whatsapp').where({ whatsapp_message_id: whatsappMessageId }).first();
}

function ultimoRegistroConsentimiento(telefono) {
  return db('consentimiento_lfpdppp').where({ telefono }).orderBy('creado_en', 'desc').first();
}

// El envío del menú tras el comando "menu" es fire-and-forget en el
// controller (nunca se espera antes de responder 200) — sin esta pausa, su
// llamada a fetch puede colarse en el conteo de la siguiente prueba.
function esperarFireAndForget() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('LFPDPPP — gate de consentimiento (feature apagada)', () => {
  it('sin aviso configurado, un mensaje nuevo se agrupa y clasifica normalmente (sin cambios de comportamiento)', async () => {
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue(null);
    const telefono = '5215500880001';

    const res = await postTexto(`${WAMID_PREFIX}apagada-1`, telefono, 'hola, tengo una duda');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}apagada-1`);
    expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/);
    const registro = await ultimoRegistroConsentimiento('525500880001');
    expect(registro).toBeUndefined();
  });

  it('con la opción deshabilitada no consulta, registra ni envía consentimiento aunque exista un aviso vigente', async () => {
    const telefono = '5215500880002';
    const obtenerAviso = jest
      .spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio')
      .mockResolvedValue(AVISO_MOCK);
    await db('configuracion_funciones')
      .where({ clave: 'whatsapp_aviso_privacidad' })
      .update({ habilitado: false });

    try {
      const res = await postTexto(
        `${WAMID_PREFIX}opcion-privacidad-apagada`,
        telefono,
        'hola, tengo una duda',
      );

      expect(res.status).toBe(200);
      const mensaje = await ultimoMensaje(`${WAMID_PREFIX}opcion-privacidad-apagada`);
      expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/);
      expect(await ultimoRegistroConsentimiento('525500880002')).toBeUndefined();
      expect(obtenerAviso).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      await db('configuracion_funciones')
        .where({ clave: 'whatsapp_aviso_privacidad' })
        .update({ habilitado: true });
    }
  });
});

describe('LFPDPPP — gate de consentimiento (feature activa)', () => {
  // insertarPendiente guarda version_aviso, y desde la migración 20260919000007
  // esa columna tiene FK contra aviso_privacidad_versiones.version — aunque
  // el servicio esté mockeado, la fila real debe existir para poder insertar.
  beforeAll(async () => {
    await db('aviso_privacidad_versiones').insert({
      version: AVISO_MOCK.version,
      nombre_archivo: AVISO_MOCK.archivo,
      nombre_original: AVISO_MOCK.nombreArchivo,
    });
  });

  afterAll(async () => {
    await db('consentimiento_lfpdppp').where('version_aviso', AVISO_MOCK.version).del();
    await db('aviso_privacidad_versiones').where({ nombre_archivo: AVISO_MOCK.archivo }).del();
  });

  beforeEach(() => {
    jest
      .spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio')
      .mockResolvedValue(AVISO_MOCK);
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  });

  it('primer mensaje de un teléfono nuevo: sube el PDF a Meta, manda el aviso, inserta fila pendiente y no forma grupo', async () => {
    const telefono = '5215500880010';

    const res = await postTexto(`${WAMID_PREFIX}nuevo-1`, telefono, 'necesito ayuda con mi perro');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}nuevo-1`);
    expect(mensaje.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');
    expect(mensaje.group_id).toBeNull();

    const registro = await ultimoRegistroConsentimiento('525500880010');
    expect(registro).toMatchObject({
      acepto: null,
      canal: 'whatsapp',
      version_aviso: AVISO_MOCK.version,
    });
    expect(registro.aviso_enviado_en).not.toBeNull();

    // 1 llamada para subir el PDF a Meta (Media API) + 1 para mandar el mensaje.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [urlMedia] = global.fetch.mock.calls[0];
    expect(urlMedia).toContain('/fake/media');
    const [, opcionesMensaje] = global.fetch.mock.calls[1];
    const cuerpoEnviado = JSON.parse(opcionesMensaje.body);
    expect(cuerpoEnviado.interactive.type).toBe('button');
    expect(cuerpoEnviado.interactive.header).toMatchObject({
      type: 'document',
      document: { id: 'media-fake-1', filename: AVISO_MOCK.nombreArchivo },
    });
  });

  it('un segundo mensaje mientras está pendiente reenvía el aviso completo de nuevo (el tutor pudo haberlo borrado o ignorado)', async () => {
    const telefono = '5215500880011';
    await postTexto(`${WAMID_PREFIX}pendiente-1`, telefono, 'hola');
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const res = await postTexto(`${WAMID_PREFIX}pendiente-2`, telefono, 'sigo esperando');

    expect(res.status).toBe(200);
    // Se reenvía completo con una clave propia (ligada al mensaje de espera
    // actual, no al original) — pedido explícito del usuario, 2026-09-21:
    // mejor insistir que dejarlo varado en silencio si borró o ignoró el
    // aviso anterior.
    expect(global.fetch).toHaveBeenCalledTimes(4);
    const intentoReenviado = await db('outbox_whatsapp')
      .where({ clave_idempotencia: `mensaje:${WAMID_PREFIX}pendiente-2:lfpdppp_aviso` })
      .first();
    expect(intentoReenviado).toMatchObject({ estado: 'enviado' });
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}pendiente-2`);
    expect(mensaje.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');
  });

  it('si el envío original nunca llegó a Meta (falla al subir el PDF), el siguiente mensaje reenvía y sí llega', async () => {
    const telefono = '5215500880099';
    let primeraSubidaFalla = true;
    global.fetch = jest.fn().mockImplementation(async (url) => {
      if (String(url).includes('/fake/media')) {
        if (primeraSubidaFalla) {
          primeraSubidaFalla = false;
          return {
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: { message: 'Authentication Error' } }),
          };
        }
        contadorMediaFake += 1;
        return { ok: true, json: () => Promise.resolve({ id: `media-fake-${contadorMediaFake}` }) };
      }
      contadorWamidFake += 1;
      return {
        ok: true,
        json: () =>
          Promise.resolve({ messages: [{ id: `wamid.lfpdppp-fake-${contadorWamidFake}` }] }),
      };
    });

    const res1 = await postTexto(`${WAMID_PREFIX}reintento-1`, telefono, 'hola');
    expect(res1.status).toBe(200);

    // La subida truena antes de registrar el intento: no queda ningún
    // rastro en outbox_whatsapp, a diferencia de un envío que sí se
    // intenta y falla.
    const sinRastro = await db('outbox_whatsapp')
      .where({ clave_idempotencia: `${WAMID_PREFIX}reintento-1:lfpdppp_aviso` })
      .first();
    expect(sinRastro).toBeUndefined();

    const res2 = await postTexto(`${WAMID_PREFIX}reintento-2`, telefono, 'sigo esperando');
    expect(res2.status).toBe(200);

    const intentoReintentado = await db('outbox_whatsapp')
      .where({ clave_idempotencia: `mensaje:${WAMID_PREFIX}reintento-2:lfpdppp_aviso` })
      .first();
    expect(intentoReintentado).toMatchObject({ estado: 'enviado' });
  });

  it('al aceptar el aviso, se resuelve la fila y los mensajes posteriores fluyen normal', async () => {
    const telefono = '5215500880012';
    await postTexto(`${WAMID_PREFIX}acepta-0`, telefono, 'hola');

    const resBoton = await postBoton(
      `${WAMID_PREFIX}acepta-boton`,
      telefono,
      'lfpdppp_acepto',
      'Estoy de acuerdo',
    );
    expect(resBoton.status).toBe(200);

    const registro = await ultimoRegistroConsentimiento('525500880012');
    expect(registro).toMatchObject({ acepto: true, wamid: `${WAMID_PREFIX}acepta-boton` });
    const mensajeBoton = await ultimoMensaje(`${WAMID_PREFIX}acepta-boton`);
    expect(mensajeBoton.estado_procesamiento).toBe('resuelto_lfpdppp');

    const resTexto = await postTexto(`${WAMID_PREFIX}acepta-real`, telefono, 'mi perro tose mucho');
    expect(resTexto.status).toBe(200);
    const mensajeReal = await ultimoMensaje(`${WAMID_PREFIX}acepta-real`);
    expect(mensajeReal.estado_procesamiento).not.toMatch(/lfpdppp/);
  });

  it('al aceptar, retoma el mensaje original que disparó la pregunta, sin que el tutor lo tenga que reescribir', async () => {
    const telefono = '5215500880016';
    await postTexto(`${WAMID_PREFIX}retoma-0`, telefono, 'mi perro no quiere comer');

    const resBoton = await postBoton(
      `${WAMID_PREFIX}retoma-acepto`,
      telefono,
      'lfpdppp_acepto',
      'Estoy de acuerdo',
    );
    expect(resBoton.status).toBe(200);

    // Se retoma con un id derivado del original, como un mensaje pendiente
    // normal — no se le pide nada de nuevo al tutor.
    const retomado = await ultimoMensaje(`${WAMID_PREFIX}retoma-0:lfpdppp_continuacion`);
    expect(retomado).toMatchObject({
      tipo_mensaje: 'text',
      mensaje_recibido: 'mi perro no quiere comer',
      estado_procesamiento: 'pendiente',
      group_id: null,
    });
    // No se clasifica de inmediato — sigue la ventana normal de
    // agrupación, igual que cualquier mensaje nuevo real.
    expect(claude.clasificarMensaje).not.toHaveBeenCalled();
    // Bug real visto en vivo 2026-09-21: sin rearmar procesar_despues_de, el
    // mensaje quedaba "pendiente" para siempre — el trabajador de
    // agrupación nunca lo hubiera recogido. Debe quedar armado para que sí
    // lo recoja más adelante.
    const conversacion = await db('conversaciones_whatsapp')
      .where({ id: retomado.conversacion_id })
      .first('procesar_despues_de');
    expect(conversacion.procesar_despues_de).not.toBeNull();
  });

  it('si el tutor escribe por partes mientras sigue pendiente, al aceptar se retoman TODOS los fragmentos juntos (bug real 2026-09-21)', async () => {
    const telefono = '5215500880018';
    await postTexto(
      `${WAMID_PREFIX}fragmento-1`,
      telefono,
      'buenas tardes, tengo un detalle con mi perro',
    );
    await postTexto(`${WAMID_PREFIX}fragmento-2`, telefono, 'en la pata');
    await postTexto(`${WAMID_PREFIX}fragmento-3`, telefono, 'y quisiera ver si me pueden ayudar');

    // Los fragmentos 2 y 3 SÍ deben conservar su contenido ahora (antes se
    // perdían: solo el primer fragmento se retenía).
    const mensaje2 = await ultimoMensaje(`${WAMID_PREFIX}fragmento-2`);
    expect(mensaje2.mensaje_recibido).toBe('en la pata');
    const mensaje3 = await ultimoMensaje(`${WAMID_PREFIX}fragmento-3`);
    expect(mensaje3.mensaje_recibido).toBe('y quisiera ver si me pueden ayudar');

    const resBoton = await postBoton(
      `${WAMID_PREFIX}fragmentos-acepto`,
      telefono,
      'lfpdppp_acepto',
      'Estoy de acuerdo',
    );
    expect(resBoton.status).toBe(200);

    // El evento retomado se deriva del ÚLTIMO fragmento (el que sí llegó a
    // ser respondido con el botón), con el texto de los 3 unido por salto de
    // línea — igual que formarGrupoParaConversacion agruparía los mismos 3
    // mensajes si nunca hubiera existido el gate de por medio.
    const retomado = await ultimoMensaje(`${WAMID_PREFIX}fragmento-3:lfpdppp_continuacion`);
    expect(retomado).toMatchObject({
      tipo_mensaje: 'text',
      mensaje_recibido:
        'buenas tardes, tengo un detalle con mi perro\nen la pata\ny quisiera ver si me pueden ayudar',
      estado_procesamiento: 'pendiente',
      group_id: null,
    });
    expect(claude.clasificarMensaje).not.toHaveBeenCalled();
  });

  it('un segundo tap de "Estoy de acuerdo" sobre una copia vieja del aviso ya no cae al flujo normal (bug real 2026-09-21)', async () => {
    const telefono = '5215500880019';
    await postTexto(`${WAMID_PREFIX}dobletap-0`, telefono, 'hola');

    const resBoton1 = await postBoton(
      `${WAMID_PREFIX}dobletap-acepto1`,
      telefono,
      'lfpdppp_acepto',
      'Estoy de acuerdo',
    );
    expect(resBoton1.status).toBe(200);

    global.fetch.mockClear();
    const resBoton2 = await postBoton(
      `${WAMID_PREFIX}dobletap-acepto2`,
      telefono,
      'lfpdppp_acepto',
      'Estoy de acuerdo',
    );
    expect(resBoton2.status).toBe(200);

    const mensaje2 = await ultimoMensaje(`${WAMID_PREFIX}dobletap-acepto2`);
    expect(mensaje2.estado_procesamiento).toBe('ignorado_lfpdppp_ya_resuelto');

    // Antes caía al flujo normal como una respuesta interactiva no
    // reconocida ("Esa opción ya no está disponible" o una respuesta
    // genérica de Claude) — ahora se reconoce el tap suelto y se responde
    // amigable, sin clasificar nada.
    expect(claude.clasificarMensaje).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opciones] = global.fetch.mock.calls[0];
    const cuerpo = JSON.parse(opciones.body);
    expect(cuerpo.text?.body).toBe('Ya habías aceptado el aviso de privacidad, gracias.');
  });

  it('si el mensaje original era un comando de menú, al aceptar se muestra el menú principal de inmediato', async () => {
    const telefono = '5215500880017';
    await postTexto(`${WAMID_PREFIX}retomamenu-0`, telefono, 'menu');

    global.fetch.mockClear();
    const resBoton = await postBoton(
      `${WAMID_PREFIX}retomamenu-acepto`,
      telefono,
      'lfpdppp_acepto',
      'Estoy de acuerdo',
    );
    expect(resBoton.status).toBe(200);
    await esperarFireAndForget();

    const [conversacion] = await buscarConversacion('525500880017');
    expect(conversacion.estado).toBe('esperando_menu');
    // El menú interactivo real se manda solo, sin que el tutor tenga que
    // volver a escribir "menu".
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opciones] = global.fetch.mock.calls[0];
    const cuerpo = JSON.parse(opciones.body);
    expect(cuerpo.interactive?.type).toBe('list');
  });

  it('al rechazar el aviso, se resuelve la fila y se solicita atención humana', async () => {
    const telefono = '5215500880013';
    await postTexto(`${WAMID_PREFIX}rechaza-0`, telefono, 'hola');

    const resBoton = await postBoton(
      `${WAMID_PREFIX}rechaza-boton`,
      telefono,
      'lfpdppp_rechazo',
      'No estoy de acuerdo',
    );
    expect(resBoton.status).toBe(200);

    const registro = await ultimoRegistroConsentimiento('525500880013');
    expect(registro).toMatchObject({ acepto: false });

    // Borrado físico: no se guarda información de quien no aceptó (pedido
    // explícito del usuario, 2026-09-21) — el fragmento retenido para
    // reproceso ya no debe existir en absoluto, no solo estar marcado.
    const mensajeRetenido = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: `${WAMID_PREFIX}rechaza-0` })
      .first();
    expect(mensajeRetenido).toBeUndefined();

    const [conversacion] = await buscarConversacion('525500880013');
    const solicitud = await db('solicitudes_atencion_humana')
      .where({ conversacion_id: conversacion.id, origen: 'consentimiento' })
      .first();
    expect(solicitud).toBeDefined();
    const alerta = await db('alertas_atencion_whatsapp')
      .where({ conversacion_id: conversacion.id, tipo_alerta: 'consentimiento' })
      .first();
    expect(alerta).toBeDefined();
  });

  it('un tutor dado de alta en el panel ya tiene consentimiento aceptado (canal panel) y su primer WhatsApp fluye normal', async () => {
    const telefonoDigitos = '5500880014';
    const propietarioId = await tutoresRepository.crear({
      nombre: 'Test',
      apellidos: 'LFPDPPP',
      telefono: telefonoDigitos,
      correo: 'test.lfpdppp@omegavet.test',
      pacientes: [],
      usuarioId: null,
    });

    const registro = await ultimoRegistroConsentimiento(`52${telefonoDigitos}`);
    expect(registro).toMatchObject({ acepto: true, canal: 'panel', propietario_id: propietarioId });

    const res = await postTexto(`${WAMID_PREFIX}panel-1`, `521${telefonoDigitos}`, 'hola');
    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}panel-1`);
    expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/);

    await db('mascotas').where({ propietario_id: propietarioId }).del();
    await db('propietarios').where({ id: propietarioId }).del();
  });
});

// Switch "Reenviar a todos" (2026-09-20): por default, un acepto viejo
// sigue contando para siempre aunque suba una versión nueva (un PDF que
// solo corrige formato no debería re-pedir consentimiento). Cuando el
// admin marca la versión vigente como que SÍ requiere reconsentimiento
// (cambio material), cualquiera cuyo último acepto no sea justo de esa
// versión debe volver a preguntarse — sin borrar el registro viejo.
describe('LFPDPPP — switch "Reenviar a todos" (requiere_reconsentimiento)', () => {
  // version_aviso tiene FK contra aviso_privacidad_versiones.version (ver
  // migración 20260919000007) — hacen falta filas reales aunque el
  // servicio de configuración esté mockeado.
  beforeAll(async () => {
    await db('aviso_privacidad_versiones').insert([
      {
        version: 'lfpdppp-switch-v1.0',
        nombre_archivo: 'aviso-reconsent-v1.pdf',
        nombre_original: 'v1.pdf',
      },
      {
        version: 'lfpdppp-switch-v2.0',
        nombre_archivo: 'aviso-reconsent-v2.pdf',
        nombre_original: 'v2.pdf',
      },
    ]);
  });

  afterAll(async () => {
    await db('consentimiento_lfpdppp')
      .whereIn('version_aviso', ['lfpdppp-switch-v1.0', 'lfpdppp-switch-v2.0'])
      .del();
    await db('aviso_privacidad_versiones')
      .whereIn('version', ['lfpdppp-switch-v1.0', 'lfpdppp-switch-v2.0'])
      .del();
  });

  async function insertarAceptoPrevio(telefono, versionAceptada) {
    await db('consentimiento_lfpdppp').insert({
      telefono,
      acepto: true,
      canal: 'whatsapp',
      version_aviso: versionAceptada,
    });
  }

  it('un acepto de una versión vieja sigue contando si la vigente NO requiere reconsentimiento', async () => {
    const telefono = '5215500880050';
    await insertarAceptoPrevio('525500880050', 'lfpdppp-switch-v1.0');
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v2.0',
      requiereReconsentimiento: false,
    });

    const res = await postTexto(`${WAMID_PREFIX}reconsent-no-1`, telefono, 'hola de nuevo');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}reconsent-no-1`);
    expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/);
    const filas = await db('consentimiento_lfpdppp').where('telefono', '525500880050');
    expect(filas).toHaveLength(1); // no se insertó nada nuevo
  });

  it('con el switch activo, un acepto de una versión vieja se ignora y se reenvía el aviso', async () => {
    const telefono = '5215500880051';
    await insertarAceptoPrevio('525500880051', 'lfpdppp-switch-v1.0');
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v2.0',
      requiereReconsentimiento: true,
    });
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));

    const res = await postTexto(`${WAMID_PREFIX}reconsent-si-1`, telefono, 'hola de nuevo');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}reconsent-si-1`);
    expect(mensaje.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');
    // El acepto viejo de v1.0 sigue intacto; se agrega una fila nueva
    // "pendiente" para la v2.0, en vez de borrar o modificar la anterior.
    const filas = await db('consentimiento_lfpdppp')
      .where('telefono', '525500880051')
      .orderBy('creado_en', 'asc');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ acepto: true, version_aviso: 'lfpdppp-switch-v1.0' });
    expect(filas[1]).toMatchObject({ acepto: null, version_aviso: 'lfpdppp-switch-v2.0' });
    // Sí se reenvió el aviso (media + mensaje interactivo).
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('con el switch activo, quien ya aceptó justo la versión vigente no se le vuelve a preguntar', async () => {
    const telefono = '5215500880052';
    await insertarAceptoPrevio('525500880052', 'lfpdppp-switch-v2.0');
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v2.0',
      requiereReconsentimiento: true,
    });

    const res = await postTexto(`${WAMID_PREFIX}reconsent-igual-1`, telefono, 'hola de nuevo');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}reconsent-igual-1`);
    expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/);
    const filas = await db('consentimiento_lfpdppp').where('telefono', '525500880052');
    expect(filas).toHaveLength(1);
  });

  // Bug real reportado 2026-09-20: el admin subió por error un archivo con
  // "Reenviar a todos" activo (disparando una re-pregunta pendiente), y
  // luego revirtió la versión vigente a una que el tutor ya había aceptado
  // antes. El tutor se quedó "atorado" esperando respuesta a una versión
  // que ya ni siquiera era la vigente — el bot dejó de contestarle.
  it('si el admin revierte a una versión ya aceptada, el tutor deja de estar atorado en la re-pregunta abandonada', async () => {
    const telefono = '5215500880053';
    await insertarAceptoPrevio('525500880053', 'lfpdppp-switch-v1.0');

    // El admin sube (por error) una versión que requiere reconsentimiento.
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValueOnce({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v2.0',
      requiereReconsentimiento: true,
    });
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    await postTexto(`${WAMID_PREFIX}reconsent-revert-0`, telefono, 'hola');
    const pendiente = await ultimoMensaje(`${WAMID_PREFIX}reconsent-revert-0`);
    expect(pendiente.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente'); // se disparó la re-pregunta

    // El admin se da cuenta del error y revierte a v1.0 (la que ya se
    // había aceptado), sin que el tutor haya respondido nunca al aviso de v2.0.
    configuracionService.obtenerVersionVigenteParaEnvio.mockResolvedValue({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v1.0',
      requiereReconsentimiento: false,
    });

    const res = await postTexto(`${WAMID_PREFIX}reconsent-revert-1`, telefono, 'sigo aquí');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}reconsent-revert-1`);
    expect(mensaje.estado_procesamiento).not.toMatch(/lfpdppp/); // ya no se ignora
    // No se insertó una tercera fila: la v2.0 pendiente sigue como evidencia,
    // pero la vigente respondida (v1.0) es la que decide.
    const filas = await db('consentimiento_lfpdppp').where('telefono', '525500880053');
    expect(filas).toHaveLength(2);
  });

  // Aclaración explícita del usuario, 2026-09-20: si DOS versiones seguidas
  // requieren reconsentimiento, solo importa la respuesta a la ÚLTIMA — un
  // pendiente sin resolver de la versión anterior queda abandonado, no
  // bloquea la re-pregunta de la nueva.
  it('si dos versiones seguidas requieren reconsentimiento, solo se pregunta por la última', async () => {
    const telefono = '5215500880054';
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));

    // Primera versión que requiere reconsentimiento: dispara una pendiente.
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValueOnce({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v1.0',
      requiereReconsentimiento: true,
    });
    await postTexto(`${WAMID_PREFIX}reconsent-doble-0`, telefono, 'hola');
    const primeraPendiente = await ultimoMensaje(`${WAMID_PREFIX}reconsent-doble-0`);
    expect(primeraPendiente.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');

    // Segunda versión, TAMBIÉN requiere reconsentimiento — el tutor nunca
    // respondió a la primera.
    configuracionService.obtenerVersionVigenteParaEnvio.mockResolvedValue({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v2.0',
      requiereReconsentimiento: true,
    });
    const res = await postTexto(`${WAMID_PREFIX}reconsent-doble-1`, telefono, 'hola otra vez');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}reconsent-doble-1`);
    expect(mensaje.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente'); // nueva re-pregunta, no la vieja
    const filas = await db('consentimiento_lfpdppp')
      .where('telefono', '525500880054')
      .orderBy('creado_en', 'asc');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ acepto: null, version_aviso: 'lfpdppp-switch-v1.0' }); // abandonada, intacta
    expect(filas[1]).toMatchObject({ acepto: null, version_aviso: 'lfpdppp-switch-v2.0' }); // la que de verdad se está pidiendo
    // Sí se reenvió el aviso otra vez (media + mensaje interactivo) para v2.0.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  // Mismo caso que el de "revierte a una versión ya aceptada", pero sin
  // ningún acepto previo en el historial: el tutor nunca ha aceptado nada,
  // se quedó pendiente de una versión que requería reconsentimiento, y el
  // admin sube otra que YA NO lo requiere. Debe tratarse como si fuera la
  // primera vez (re-pregunta normal), no seguir esperando la vieja.
  it('sin ningún acepto previo, si la nueva versión ya no requiere reconsentimiento se reinicia como primera vez', async () => {
    const telefono = '5215500880055';
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));

    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValueOnce({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v1.0',
      requiereReconsentimiento: true,
    });
    await postTexto(`${WAMID_PREFIX}reconsent-primera-0`, telefono, 'hola');
    const primeraPendiente = await ultimoMensaje(`${WAMID_PREFIX}reconsent-primera-0`);
    expect(primeraPendiente.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');

    configuracionService.obtenerVersionVigenteParaEnvio.mockResolvedValue({
      ...AVISO_MOCK,
      version: 'lfpdppp-switch-v2.0',
      requiereReconsentimiento: false,
    });
    const res = await postTexto(`${WAMID_PREFIX}reconsent-primera-1`, telefono, 'hola otra vez');

    expect(res.status).toBe(200);
    const mensaje = await ultimoMensaje(`${WAMID_PREFIX}reconsent-primera-1`);
    // Se reinicia: nueva re-pregunta para v2.0, no sigue atorado en v1.0.
    expect(mensaje.estado_procesamiento).toBe('ignorado_lfpdppp_pendiente');
    const filas = await db('consentimiento_lfpdppp')
      .where('telefono', '525500880055')
      .orderBy('creado_en', 'asc');
    expect(filas).toHaveLength(2);
    expect(filas[1]).toMatchObject({ acepto: null, version_aviso: 'lfpdppp-switch-v2.0' });
  });
});

describe('LFPDPPP — el media_id se cachea y no se resube en cada solicitud', () => {
  const NOMBRE_ARCHIVO = 'aviso-privacidad-cache-test.pdf';

  beforeEach(async () => {
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    await db('configuracion_sistema')
      .insert([
        { clave: 'aviso_privacidad_archivo', valor: NOMBRE_ARCHIVO },
        { clave: 'aviso_privacidad_version', valor: 'v-cache-test' },
        { clave: 'aviso_privacidad_nombre', valor: 'Aviso Cache Test.pdf' },
      ])
      .onConflict('clave')
      .merge(['valor']);
    // onConflict('version') en vez de un insert liso: si un run anterior
    // dejó esta fila a medio limpiar (afterEach interrumpido), un insert
    // liso chocaría con aviso_privacidad_versiones_version_unique y
    // tumbaría TODA la suite en cascada — se vio pasar en vivo 2026-09-20.
    await db('aviso_privacidad_versiones')
      .insert({
        version: 'v-cache-test',
        nombre_archivo: NOMBRE_ARCHIVO,
        nombre_original: 'Aviso Cache Test.pdf',
      })
      .onConflict('version')
      .merge(['nombre_archivo', 'nombre_original', 'media_id']);
  });

  afterEach(async () => {
    // Por version_aviso (no por prefijo de teléfono): cualquier fila que
    // referencie esta versión debe borrarse primero o el delete de
    // aviso_privacidad_versiones falla (FK con ON DELETE RESTRICT, ver
    // migración 20260919000007) — un teléfono de OTRO test tocando esta
    // misma versión por accidente ya dejó la suite entera en cascada.
    await db('consentimiento_lfpdppp').where('version_aviso', 'v-cache-test').del();
    await db('configuracion_sistema').where('clave', 'like', 'aviso_privacidad_%').del();
    await db('aviso_privacidad_versiones').where({ nombre_archivo: NOMBRE_ARCHIVO }).del();
  });

  it('dos teléfonos nuevos distintos disparan una sola subida a Meta, no dos', async () => {
    await postTexto(`${WAMID_PREFIX}cache-tel1`, '5215500880030', 'hola');
    await postTexto(`${WAMID_PREFIX}cache-tel2`, '5215500880031', 'hola');

    const llamadasAMedia = global.fetch.mock.calls.filter(([url]) =>
      String(url).includes('/fake/media'),
    );
    expect(llamadasAMedia).toHaveLength(1);

    const fila = await db('aviso_privacidad_versiones')
      .where({ nombre_archivo: NOMBRE_ARCHIVO })
      .first();
    expect(fila.media_id).toMatch(/^media-fake-\d+$/);
  });
});

describe('LFPDPPP — integridad referencial version_aviso -> aviso_privacidad_versiones', () => {
  const TELEFONO = '5215500990099';
  let versionId;

  afterEach(async () => {
    await db('consentimiento_lfpdppp').where({ telefono: TELEFONO }).del();
    if (versionId) {
      await db('aviso_privacidad_versiones')
        .where({ id: versionId })
        .del()
        .catch(() => {});
      versionId = null;
    }
  });

  it('la base de datos rechaza borrar una versión mientras un consentimiento la referencie', async () => {
    const [fila] = await db('aviso_privacidad_versiones')
      .insert({
        version: `v-integridad-${Date.now()}`,
        nombre_archivo: `aviso-integridad-${crypto.randomUUID()}.pdf`,
        nombre_original: 'aviso.pdf',
      })
      .returning('*');
    versionId = fila.id;

    await db('consentimiento_lfpdppp').insert({
      telefono: TELEFONO,
      acepto: true,
      canal: 'whatsapp',
      version_aviso: fila.version,
    });

    await expect(db('aviso_privacidad_versiones').where({ id: versionId }).del()).rejects.toThrow();
  });
});

describe('LFPDPPP — "Ver aviso de privacidad" en el menú principal', () => {
  it('con aviso configurado, envía el PDF como documento informativo (sin botones de aceptar/rechazar)', async () => {
    const AVISO = {
      archivo: 'aviso-privacidad-test.pdf',
      version: '2026-09-19',
      nombreArchivo: 'Aviso de Privacidad Omega.pdf',
    };
    // Aceptar el aviso inserta version_aviso en consentimiento_lfpdppp, y
    // esa columna tiene FK contra aviso_privacidad_versiones.version desde
    // la migración 20260919000007 — hace falta la fila real aunque el
    // servicio esté mockeado.
    await db('aviso_privacidad_versiones').insert({
      version: AVISO.version,
      nombre_archivo: AVISO.archivo,
      nombre_original: AVISO.nombreArchivo,
    });
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue(AVISO);
    jest
      .spyOn(configuracionService, 'leerArchivoAviso')
      .mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    const telefono = '5215500880020';

    try {
      // Primero hay que aceptar el aviso para poder llegar al menú (si no,
      // el gate se come hasta el comando "menu").
      await postTexto(`${WAMID_PREFIX}menuaviso-0`, telefono, 'hola');
      await postBoton(
        `${WAMID_PREFIX}menuaviso-acepto`,
        telefono,
        'lfpdppp_acepto',
        'Estoy de acuerdo',
      );

      // Al aceptar, el "hola" original se retoma como un mensaje pendiente
      // normal (ver procesarConsentimientoLfpdppp) — en producción el
      // worker de agrupación (cada pocos segundos) ya lo habría agrupado
      // mucho antes de que el tutor alcance a escribir otra cosa. Se marca
      // como ya resuelto en vez de invocar el worker real (que es GLOBAL,
      // sin filtrar por conversación — arriesgaría atrapar la vencida de
      // OTRA prueba de este archivo), para que no quede una fila
      // "pendiente" huérfana confundiendo al siguiente comando "menu"
      // (confirmarMenuEnviado también mira esa columna).
      await db('mensajes_whatsapp')
        .where('whatsapp_message_id', `${WAMID_PREFIX}menuaviso-0:lfpdppp_continuacion`)
        .update({ estado_procesamiento: 'procesado' });

      await postTexto(`${WAMID_PREFIX}menuaviso-menu`, telefono, 'menu');
      await esperarFireAndForget();

      global.fetch.mockClear();
      const res = await postListReply(
        `${WAMID_PREFIX}menuaviso-seleccion`,
        telefono,
        menu.MENU_AVISO_PRIVACIDAD,
        'Aviso de privacidad',
      );

      expect(res.status).toBe(200);
      // 1 llamada para subir el PDF a Meta + 1 para mandar el documento.
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [urlMedia] = global.fetch.mock.calls[0];
      expect(urlMedia).toContain('/fake/media');
      const [, opcionesDocumento] = global.fetch.mock.calls[1];
      const cuerpoEnviado = JSON.parse(opcionesDocumento.body);
      expect(cuerpoEnviado.type).toBe('document');
      expect(cuerpoEnviado.document).toMatchObject({
        id: expect.stringContaining('media-fake-'),
        filename: 'Aviso de Privacidad Omega.pdf',
      });
      expect(cuerpoEnviado.interactive).toBeUndefined();
    } finally {
      await db('consentimiento_lfpdppp').where('version_aviso', AVISO.version).del();
      await db('aviso_privacidad_versiones').where({ nombre_archivo: AVISO.archivo }).del();
    }
  });

  it('sin aviso configurado, manda un texto de respaldo en vez de fallar en silencio', async () => {
    jest.spyOn(configuracionService, 'obtenerVersionVigenteParaEnvio').mockResolvedValue(null);
    const telefono = '5215500880021';

    // Este teléfono nunca ve el gate LFPDPPP porque la funcionalidad está
    // apagada (sin aviso configurado) — llega al menú directo.
    await postTexto(`${WAMID_PREFIX}menuaviso2-menu`, telefono, 'menu');
    await esperarFireAndForget();

    global.fetch.mockClear();
    const res = await postListReply(
      `${WAMID_PREFIX}menuaviso2-seleccion`,
      telefono,
      menu.MENU_AVISO_PRIVACIDAD,
      'Aviso de privacidad',
    );

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1); // solo el texto de respaldo
    const [, opciones] = global.fetch.mock.calls[0];
    const cuerpoEnviado = JSON.parse(opciones.body);
    expect(cuerpoEnviado.type).toBe('text');
    expect(cuerpoEnviado.text.body).toContain('no tenemos un aviso de privacidad disponible');
  });
});
