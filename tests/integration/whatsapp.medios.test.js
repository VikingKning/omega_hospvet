// US WA 014 — agrupación de archivos y respuesta para medios no
// interpretables. Necesita Postgres real: FOR UPDATE SKIP LOCKED, el
// reloj de la BD para procesar_despues_de, y el índice único parcial de
// grupos_whatsapp — no se puede mockear (mismo criterio que
// whatsapp.agrupacion.test.js).
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const service = require('../../src/modules/whatsapp/whatsapp.service');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion-medios';
const VERIFY_TOKEN = 'verify-token-de-integracion-medios';

const WAMID_PREFIX = 'wamid.medios-';
const PHONE_NUMBER_ID = 'phone-integ-medios-test';

const originalFetch = global.fetch;

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

let contadorWamidFake = 0;

beforeEach(() => {
  // outbox_whatsapp.wamid tiene un índice único real (US WA 015) — un wamid
  // fijo compartido entre pruebas chocaría en cuanto más de una prueba de
  // este archivo de verdad completa un envío (varias lo hacen).
  global.fetch = jest.fn().mockImplementation(async () => {
    contadorWamidFake += 1;
    return {
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: `wamid.medios-fake-${contadorWamidFake}` }] }),
    };
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  // US WA 009: un grupo con texto procesable ahora se clasifica de verdad
  // — este archivo prueba la mecánica de agrupación de medios (US WA 014),
  // no la clasificación en sí (eso vive en tests/unit/whatsapp.service.test.js
  // y en whatsapp.agrupacion.test.js) — se mockea sin coincidencia para no
  // pegarle a la API real de Claude.
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
  // grupo_medio_pendiente_id (US WA 014) referencia grupos_whatsapp — hay
  // que limpiarlo antes de poder borrar los grupos.
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

// Mismo criterio que whatsapp.agrupacion.test.js: reloj real, nunca un
// timestamp fijo histórico (contaminaría pruebas paralelas en la misma BD).
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
const imagenMsg = ({ caption, mediaId = 'media-img', mimeType = 'image/jpeg' } = {}) => ({
  type: 'image',
  image: { id: mediaId, caption, mime_type: mimeType },
});
const documentoMsg = ({ caption, mediaId = 'media-doc', mimeType = 'application/pdf' } = {}) => ({
  type: 'document',
  document: { id: mediaId, caption, mime_type: mimeType },
});
const audioMsg = ({ mediaId = 'media-audio', mimeType = 'audio/ogg' } = {}) => ({
  type: 'audio',
  audio: { id: mediaId, mime_type: mimeType },
});
const stickerMsg = ({ mediaId = 'media-sticker', mimeType = 'image/webp' } = {}) => ({
  type: 'sticker',
  sticker: { id: mediaId, mime_type: mimeType },
});

function buscarConversacion(telefonoNormalizado) {
  return db('conversaciones_whatsapp')
    .where({ phone_number_id: PHONE_NUMBER_ID, telefono_normalizado: telefonoNormalizado })
    .orderBy('id', 'desc');
}

async function vencerConversacion(id) {
  await db('conversaciones_whatsapp')
    .where({ id })
    .update({ procesar_despues_de: new Date(Date.now() - 1000) });
}

describe('US WA 014 — grupo con texto procesable (medio + explicación en la misma ventana)', () => {
  it('imagen seguida de texto dentro de 10 segundos: el texto es procesable, la imagen se marca no_interpretable_bot (AC1/AC3, prueba mínima)', async () => {
    const telefono = '5215500020001';
    await postMensaje(`${WAMID_PREFIX}img-1`, telefono, imagenMsg(), ahoraEpoch(0));
    await postMensaje(
      `${WAMID_PREFIX}img-2`,
      telefono,
      textoMsg('mi perro tiene esta herida'),
      ahoraEpoch(1),
    );
    const [conversacion] = await buscarConversacion('525500020001');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.tieneTextoProcesable).toBe(true);
    expect(resultado.texto_consolidado).toBe('mi perro tiene esta herida');
    const mensajes = await db('mensajes_whatsapp').where({ group_id: resultado.groupId });
    expect(mensajes).toHaveLength(2);
    const imagen = mensajes.find((m) => m.tipo_mensaje === 'image');
    // Técnica: se marca no_interpretable_bot DESPUÉS de formar el grupo —
    // esta imagen en particular nunca tuvo caption, así que sigue sin
    // interpretarse aunque el grupo, como conjunto, sí tenga texto (el de
    // otro mensaje).
    expect(imagen.estado_procesamiento).toBe('no_interpretable_bot');
    // US WA 009: el texto procesable ya no queda sin resolver — se
    // clasifica (mockeado a sin_coincidencia arriba) y se envía la
    // respuesta de respaldo.
    expect(resultado.resultado).toBe('clasificado_normal');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('imagen con caption: el caption es el texto procesable, no se marca no_interpretable_bot (AC2, prueba mínima)', async () => {
    const telefono = '5215500020002';
    await postMensaje(
      `${WAMID_PREFIX}cap-1`,
      telefono,
      imagenMsg({ caption: 'aquí la herida de mi perro' }),
    );
    const [conversacion] = await buscarConversacion('525500020002');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.tieneTextoProcesable).toBe(true);
    expect(resultado.texto_consolidado).toBe('aquí la herida de mi perro');
    const [mensaje] = await db('mensajes_whatsapp').where({ group_id: resultado.groupId });
    expect(mensaje.estado_procesamiento).toBe('procesado');
    expect(mensaje.media_id).toBe('media-img'); // AC2: media_id se conserva para auditoría/atención humana.
  });

  it('documento con texto posterior: el texto es procesable (prueba mínima)', async () => {
    const telefono = '5215500020003';
    await postMensaje(`${WAMID_PREFIX}doc-1`, telefono, documentoMsg(), ahoraEpoch(0));
    await postMensaje(
      `${WAMID_PREFIX}doc-2`,
      telefono,
      textoMsg('son los resultados del laboratorio'),
      ahoraEpoch(1),
    );
    const [conversacion] = await buscarConversacion('525500020003');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.tieneTextoProcesable).toBe(true);
    expect(resultado.texto_consolidado).toBe('son los resultados del laboratorio');
  });
});

describe('US WA 014 — grupo sin texto procesable: solicita explicación (AC4)', () => {
  it('varias imágenes sin texto: un solo mensaje de orientación, ambas marcadas no_interpretable_bot (AC1/AC4/AC8, prueba mínima)', async () => {
    const telefono = '5215500020004';
    await postMensaje(
      `${WAMID_PREFIX}multi-img-1`,
      telefono,
      imagenMsg({ mediaId: 'm1' }),
      ahoraEpoch(0),
    );
    await postMensaje(
      `${WAMID_PREFIX}multi-img-2`,
      telefono,
      imagenMsg({ mediaId: 'm2' }),
      ahoraEpoch(1),
    );
    const [conversacion] = await buscarConversacion('525500020004');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('guia_enviada');
    expect(global.fetch).toHaveBeenCalledTimes(1); // AC8: una sola respuesta, no una por archivo.
    const mensajes = await db('mensajes_whatsapp').where({ group_id: resultado.groupId });
    expect(mensajes).toHaveLength(2);
    mensajes.forEach((m) => expect(m.estado_procesamiento).toBe('no_interpretable_bot'));
    const actualizada = await db('conversaciones_whatsapp').where({ id: conversacion.id }).first();
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.flujo_actual).toBe('explicacion_medio');
    expect(actualizada.paso_actual).toBe('esperando_descripcion');
    expect(actualizada.grupo_medio_pendiente_id).toBe(resultado.groupId);
    const grupo = await db('grupos_whatsapp').where({ group_id: resultado.groupId }).first();
    expect(grupo.estado).toBe('procesado');
    expect(grupo.procesado_en).not.toBeNull();
  });

  it('audio seguido de texto: el texto es procesable, no se solicita explicación (prueba mínima)', async () => {
    const telefono = '5215500020005';
    await postMensaje(`${WAMID_PREFIX}audio-1`, telefono, audioMsg(), ahoraEpoch(0));
    await postMensaje(
      `${WAMID_PREFIX}audio-2`,
      telefono,
      textoMsg('era un audio explicando el dolor'),
      ahoraEpoch(1),
    );
    const [conversacion] = await buscarConversacion('525500020005');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    // US WA 009: el texto procesable ya no queda sin resolver — se
    // clasifica (mockeado a sin_coincidencia arriba) y se envía la
    // respuesta de respaldo, en vez de solicitar una explicación (AC4 de
    // US WA 014 solo aplica cuando el grupo NO tiene texto procesable).
    expect(resultado.resultado).toBe('clasificado_normal');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('varias notas de voz sin texto: un solo mensaje de orientación (AC8, prueba mínima)', async () => {
    const telefono = '5215500020006';
    await postMensaje(
      `${WAMID_PREFIX}audios-1`,
      telefono,
      audioMsg({ mediaId: 'a1' }),
      ahoraEpoch(0),
    );
    await postMensaje(
      `${WAMID_PREFIX}audios-2`,
      telefono,
      audioMsg({ mediaId: 'a2' }),
      ahoraEpoch(1),
    );
    await postMensaje(
      `${WAMID_PREFIX}audios-3`,
      telefono,
      audioMsg({ mediaId: 'a3' }),
      ahoraEpoch(2),
    );
    const [conversacion] = await buscarConversacion('525500020006');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('guia_enviada');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const mensajes = await db('mensajes_whatsapp').where({ group_id: resultado.groupId });
    expect(mensajes).toHaveLength(3);
  });

  it('sticker sin texto: también dispara la solicitud de explicación (prueba mínima)', async () => {
    const telefono = '5215500020007';
    await postMensaje(`${WAMID_PREFIX}sticker-1`, telefono, stickerMsg());
    const [conversacion] = await buscarConversacion('525500020007');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('guia_enviada');
    const [mensaje] = await db('mensajes_whatsapp').where({ group_id: resultado.groupId });
    expect(mensaje.estado_procesamiento).toBe('no_interpretable_bot');
  });

  it('el texto de la guía no llama a Claude (prueba mínima: ausencia de contenido binario enviado a Claude)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telefono = '5215500020008';
    await postMensaje(`${WAMID_PREFIX}sinclaude-1`, telefono, imagenMsg());
    const [conversacion] = await buscarConversacion('525500020008');
    await vencerConversacion(conversacion.id);

    await service.procesarSiguienteConversacionVencida();

    expect(spyClasificar).not.toHaveBeenCalled();
    // El único fetch es el texto de orientación — nunca el media_id ni bytes del archivo.
    const [, opciones] = global.fetch.mock.calls[0];
    const body = JSON.parse(opciones.body);
    expect(body.type).toBe('text');
    expect(JSON.stringify(body)).not.toContain('media-img');
  });
});

// US WA 017 (AC7-AC9) SUSTITUYE el comportamiento que esta prueba
// verificaba antes de que esa historia existiera: un medio recibido
// durante atención humana YA NO conserva media_id "disponible para el
// personal" — AC8 es explícito ("sin guardar texto, caption, media_id ni
// contenido clínico"), solo metadatos técnicos. El resto de la prueba
// original (el bot no agrupa, no reclama, no llama a Meta) sigue siendo
// cierto y se conserva tal cual.
describe('US WA 014/017 — medio durante atención humana', () => {
  it('un medio recibido durante atención humana NO conserva media_id (US WA 017 AC8); el bot permanece en silencio', async () => {
    const telefono = '5215500020009';
    await postMensaje(`${WAMID_PREFIX}humana-1`, telefono, textoMsg('hola'));
    const [conversacion] = await buscarConversacion('525500020009');
    await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({
        estado: 'atencion_humana',
        atencion_humana_hasta: db.raw("now() + interval '5 hours'"),
      });

    await postMensaje(`${WAMID_PREFIX}humana-2`, telefono, imagenMsg());

    const mensajeMedio = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: `${WAMID_PREFIX}humana-2` })
      .first();
    expect(mensajeMedio.media_id).toBeNull(); // US WA 017 AC8: solo metadatos.
    expect(mensajeMedio.mensaje_recibido).toBeNull();
    expect(mensajeMedio.estado_procesamiento).toBe('ignorado_atencion_humana');
    expect(mensajeMedio.group_id).toBeNull(); // el bot nunca la agrupa/procesa.

    const resultado = await service.procesarSiguienteConversacionVencida();
    expect(resultado).toBeNull(); // atencion_humana nunca se reclama por este worker.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('US WA 014 — resolución de la explicación (AC5/AC6/AC7)', () => {
  it('el tutor escribe la explicación después: forma un nuevo grupo, lo relaciona con el de medios y cierra la conversación (AC5/AC6)', async () => {
    const telefono = '5215500020010';
    await postMensaje(`${WAMID_PREFIX}explica-1`, telefono, imagenMsg());
    const [conversacion] = await buscarConversacion('525500020010');
    await vencerConversacion(conversacion.id);
    const grupoMedios = await service.procesarSiguienteConversacionVencida();
    expect(grupoMedios.resultado).toBe('guia_enviada');

    // AC5: el tutor escribe su explicación mientras está en
    // flujo_activo/esperando_descripcion — debe re-armar la ventana de 10s.
    await postMensaje(
      `${WAMID_PREFIX}explica-2`,
      telefono,
      textoMsg('era una radiografía de mi perro'),
    );
    let actualizada = await db('conversaciones_whatsapp').where({ id: conversacion.id }).first();
    expect(actualizada.estado).toBe('flujo_activo');
    expect(actualizada.procesar_despues_de).not.toBeNull();
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('clasificado_normal');
    expect(resultado.texto_consolidado).toBe('era una radiografía de mi perro');
    const grupoTexto = await db('grupos_whatsapp').where({ group_id: resultado.groupId }).first();
    expect(grupoTexto.grupo_origen_id).toBe(grupoMedios.groupId);
    actualizada = await db('conversaciones_whatsapp').where({ id: conversacion.id }).first();
    expect(actualizada.estado).toBe('cerrada');
    expect(actualizada.flujo_actual).toBeNull();
    expect(actualizada.paso_actual).toBeNull();
    expect(actualizada.grupo_medio_pendiente_id).toBeNull();
    // AC6: no se reenvían los archivos a Claude ni se repite la solicitud;
    // sí sale la respuesta definitiva producida por el enrutamiento normal.
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // AC7: un mensaje tras el cierre crea una conversación nueva.
    await postMensaje(`${WAMID_PREFIX}explica-3`, telefono, textoMsg('otra consulta'));
    const conversaciones = await buscarConversacion('525500020010');
    expect(conversaciones).toHaveLength(2);
    expect(conversaciones[0].estado).toBe('acumulando');
  });

  it('seguimiento (US WA 013) sigue vigente durante esperando_descripcion (AC7)', async () => {
    const telefono = '5215500020011';
    await postMensaje(`${WAMID_PREFIX}segui-1`, telefono, imagenMsg());
    const [conversacion] = await buscarConversacion('525500020011');
    await vencerConversacion(conversacion.id);
    await service.procesarSiguienteConversacionVencida();

    const actualizada = await db('conversaciones_whatsapp').where({ id: conversacion.id }).first();
    expect(actualizada.recordatorio_programado_en).not.toBeNull();
    expect(actualizada.recordatorio_enviado_en).toBeNull();

    await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({ recordatorio_programado_en: new Date(Date.now() - 1000) });

    const id = await service.procesarSiguienteSeguimientoPendiente();

    expect(id).toBe(conversacion.id);
    expect(global.fetch).toHaveBeenCalledTimes(2); // guía original + pregunta de seguimiento.
  });
});
