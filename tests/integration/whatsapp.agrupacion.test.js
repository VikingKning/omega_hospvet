// US WA 003 — agrupación de mensajes por ventana de inactividad. Necesita
// Postgres real: FOR UPDATE SKIP LOCKED, el reloj de la BD para
// procesar_despues_de, y el índice único parcial de grupos_whatsapp — no
// se puede mockear. No mockea Claude/WhatsApp: esta historia nunca los
// toca (AC9/AC15), así que si algún test los llamara por error, tronaría
// contra la red real en vez de pasar en silencio.
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const service = require('../../src/modules/whatsapp/whatsapp.service');

const APP_SECRET_ORIGINAL = env.whatsapp.appSecret;
const VERIFY_TOKEN_ORIGINAL = env.whatsapp.webhookVerifyToken;
const APP_SECRET = 'app-secret-de-integracion-agrupacion';
const VERIFY_TOKEN = 'verify-token-de-integracion-agrupacion';

const WAMID_PREFIX = 'wamid.agrup-';
const PHONE_NUMBER_ID = 'phone-integ-agrupacion-test';

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

afterAll(async () => {
  env.whatsapp.appSecret = APP_SECRET_ORIGINAL;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN_ORIGINAL;
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  // mensajes_whatsapp referencia grupos_whatsapp Y conversaciones_whatsapp
  // (sin CASCADE) — hay que borrar mensajes primero, luego grupos, luego
  // conversaciones, o las FK truenan.
  // US WA 004: outbox_whatsapp.conversacion_id tiene FK hacia
  // conversaciones_whatsapp — hay que borrar antes que las conversaciones.
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

// A diferencia de whatsapp.test.js/whatsapp.conversaciones.test.js (que
// nunca comparan procesar_despues_de contra el reloj real), este archivo
// SÍ lo hace — un timestamp fijo en el pasado (como el 1700000000 que usan
// esos otros archivos) dejaría toda conversación "vencida" desde que se
// crea. Por default se usa la hora real; vencerConversacion() se usa
// explícitamente cuando una prueba necesita forzar el vencimiento.
function ahoraEpoch(offsetSegundos = 0) {
  return String(Math.floor(Date.now() / 1000) + offsetSegundos);
}

function payloadTexto(wamid, from, texto, timestamp = ahoraEpoch()) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [{ id: wamid, from, timestamp, type: 'text', text: { body: texto } }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

async function postMensaje(wamid, from, texto, timestamp) {
  const rawBody = JSON.stringify(payloadTexto(wamid, from, texto, timestamp));
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

// Deja una conversación "vencida" a mano, sin esperar los 10s reales del
// debounce — mismo criterio que el resto de la suite (nunca esperar
// tiempo real de más para una prueba).
async function vencerConversacion(id) {
  await db('conversaciones_whatsapp')
    .where({ id })
    .update({ procesar_despues_de: new Date(Date.now() - 1000) });
}

describe('whatsappAgrupacionJob / whatsapp.service — agrupación de mensajes (US WA 003)', () => {
  it('cinco fragmentos dentro de una misma ventana forman un solo grupo (AC7/AC9)', async () => {
    const telefono = '5215500002001';
    for (const [i, texto] of ['uno', 'dos', 'tres', 'cuatro', 'cinco'].entries()) {
      await postMensaje(`${WAMID_PREFIX}cinco-${i}`, telefono, texto, ahoraEpoch(i));
    }
    const [conversacion] = await buscarConversacion('525500002001');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado).not.toBeNull();
    const grupos = await db('grupos_whatsapp').where({ conversacion_id: conversacion.id });
    expect(grupos).toHaveLength(1);
    expect(grupos[0].estado).toBe('pendiente_enrutamiento');
    const mensajes = await db('mensajes_whatsapp').where({ group_id: grupos[0].group_id });
    expect(mensajes).toHaveLength(5);
  });

  it('conserva el orden cronológico y separa los fragmentos sin unir palabras (AC8)', async () => {
    const telefono = '5215500002002';
    await postMensaje(`${WAMID_PREFIX}orden-0`, telefono, 'hola doctor', ahoraEpoch(0));
    await postMensaje(`${WAMID_PREFIX}orden-1`, telefono, 'mi perro no come', ahoraEpoch(1));
    const [conversacion] = await buscarConversacion('525500002002');
    await vencerConversacion(conversacion.id);

    await service.procesarSiguienteConversacionVencida();

    const grupo = await db('grupos_whatsapp').where({ conversacion_id: conversacion.id }).first();
    expect(grupo.texto_consolidado).toBe('hola doctor\nmi perro no come');
  });

  it('una conversación cuyo procesar_despues_de todavía no vence no se reclama (AC6)', async () => {
    const telefono = '5215500002003';
    await postMensaje(`${WAMID_PREFIX}novencido`, telefono, 'hola', ahoraEpoch());
    const [antes] = await buscarConversacion('525500002003');
    expect(antes.estado).toBe('acumulando');

    const conversacionId = await repository.reclamarConversacionVencida({
      segundosRecuperacion: 120,
    });

    // Puede que otra conversación vencida de un test anterior siga por
    // ahí en la BD compartida — lo único que importa es que ESTA no se
    // haya tocado.
    const [despues] = await buscarConversacion('525500002003');
    expect(despues.estado).toBe('acumulando');
    expect(despues.procesamiento_iniciado_en).toBeNull();
    if (conversacionId !== null) expect(conversacionId).not.toBe(antes.id);
  });

  it('transición atómica de acumulando a procesando al reclamar (AC5)', async () => {
    const telefono = '5215500002004';
    await postMensaje(`${WAMID_PREFIX}transicion`, telefono, 'hola', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002004');
    await vencerConversacion(conversacion.id);

    const reclamadaId = await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });

    expect(reclamadaId).toBe(conversacion.id);
    const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
    expect(actualizada.estado).toBe('procesando');
    expect(actualizada.procesamiento_iniciado_en).not.toBeNull();
  });

  it('dos teléfonos procesados simultáneamente mantienen su propio vencimiento y fragmentos (AC15)', async () => {
    const [resA, resB] = await Promise.all([
      postMensaje(`${WAMID_PREFIX}tel-a`, '5215500002005', 'hola a', ahoraEpoch()),
      postMensaje(`${WAMID_PREFIX}tel-b`, '5215500002006', 'hola b', ahoraEpoch()),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const [convA] = await buscarConversacion('525500002005');
    const [convB] = await buscarConversacion('525500002006');
    expect(convA.id).not.toBe(convB.id);
    expect(convA.procesar_despues_de).not.toBeNull();
    expect(convB.procesar_despues_de).not.toBeNull();
  });

  it('mensaje recibido mientras el grupo anterior está reclamado queda pendiente para un grupo posterior (AC10)', async () => {
    const telefono = '5215500002007';
    await postMensaje(`${WAMID_PREFIX}tardio-1`, telefono, 'primero', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002007');
    await vencerConversacion(conversacion.id);

    const reclamadaId = await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });
    expect(reclamadaId).toBe(conversacion.id);

    // El grupo ya se formó (ya está "en procesamiento", AC10) ANTES de que
    // llegue el mensaje nuevo.
    const resultado = await repository.formarGrupoParaConversacion(conversacion.id);
    expect(resultado).not.toBeNull();

    await postMensaje(`${WAMID_PREFIX}tardio-2`, telefono, 'segundo', ahoraEpoch(5));

    const grupo = await db('grupos_whatsapp').where({ group_id: resultado.groupId }).first();
    expect(grupo.texto_consolidado).toBe('primero');
    const segundoMensaje = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: `${WAMID_PREFIX}tardio-2` })
      .first();
    expect(segundoMensaje.group_id).toBeNull();
  });

  it('reinicio de PM2 tras cambiar a procesando: otro worker recupera la conversación abandonada (AC13)', async () => {
    const telefono = '5215500002008';
    await postMensaje(`${WAMID_PREFIX}pm2`, telefono, 'hola', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002008');

    // Simula: un worker ya reclamó (procesando) pero nunca llegó a formar
    // el grupo (crash) — nada en memoria de ese intento anterior.
    await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({
        estado: 'procesando',
        procesamiento_iniciado_en: new Date(Date.now() - 5 * 60 * 1000),
      });

    const reclamadaId = await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });

    expect(reclamadaId).toBe(conversacion.id);
    const resultado = await repository.formarGrupoParaConversacion(conversacion.id);
    expect(resultado).not.toBeNull();
    const grupos = await db('grupos_whatsapp').where({ conversacion_id: conversacion.id });
    expect(grupos).toHaveLength(1);
  });

  it('dos workers reclamando simultáneamente la misma conversación: solo uno la obtiene (AC11)', async () => {
    const telefono = '5215500002009';
    await postMensaje(`${WAMID_PREFIX}concurrente`, telefono, 'hola', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002009');
    await vencerConversacion(conversacion.id);

    const [idA, idB] = await Promise.all([
      repository.reclamarConversacionVencida({ segundosRecuperacion: 120 }),
      repository.reclamarConversacionVencida({ segundosRecuperacion: 120 }),
    ]);

    const ganadores = [idA, idB].filter((id) => id === conversacion.id);
    expect(ganadores).toHaveLength(1);
  });

  it('recuperación de una reclamación abandonada: reutiliza el mismo group_id, no crea un grupo duplicado (AC12/AC13)', async () => {
    const telefono = '5215500002010';
    await postMensaje(`${WAMID_PREFIX}recuperacion`, telefono, 'hola', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002010');
    await vencerConversacion(conversacion.id);
    await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });

    const primero = await repository.formarGrupoParaConversacion(conversacion.id);
    const segundo = await repository.formarGrupoParaConversacion(conversacion.id);

    expect(segundo.groupId).toBe(primero.groupId);
    expect(segundo.reutilizado).toBe(true);
    const grupos = await db('grupos_whatsapp').where({ conversacion_id: conversacion.id });
    expect(grupos).toHaveLength(1);
  });

  it('conversación vencida sin mensajes pendientes: no crea un grupo vacío, cierra la conversación (AC14)', async () => {
    const telefono = '5215500002011';
    await postMensaje(`${WAMID_PREFIX}vacio`, telefono, 'hola', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002011');
    // Todos sus mensajes ya pertenecen a otro grupo (simulado a mano).
    const [grupoAnterior] = await db('grupos_whatsapp')
      .insert({
        conversacion_id: conversacion.id,
        texto_consolidado: 'ya procesado antes',
        estado: 'enrutado_de_prueba',
      })
      .returning('group_id');
    await db('mensajes_whatsapp')
      .where({ conversacion_id: conversacion.id })
      .update({ group_id: grupoAnterior.group_id });
    await vencerConversacion(conversacion.id);
    await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });

    const resultado = await repository.formarGrupoParaConversacion(conversacion.id);

    expect(resultado).toBeNull();
    const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
    expect(actualizada.estado).toBe('cerrada');
    const gruposPendientes = await db('grupos_whatsapp').where({
      conversacion_id: conversacion.id,
      estado: 'pendiente_enrutamiento',
    });
    expect(gruposPendientes).toHaveLength(0);
  });

  it('esta historia no llama a Claude ni envía mensajes por WhatsApp (AC9/AC15)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const originalFetch = global.fetch;
    global.fetch = jest.fn();

    const telefono = '5215500002012';
    // US WA 004: 'hola' por sí solo ahora SÍ dispara el menú (AC1) — se usa
    // un texto normal, no-saludo/no-comando, para conservar la intención
    // original de esta prueba (un grupo cualquiera nunca llama a Claude ni
    // a WhatsApp desde esta historia, US WA 003 AC9/AC15).
    await postMensaje(
      `${WAMID_PREFIX}sinclaude`,
      telefono,
      'mi perro no quiere comer',
      ahoraEpoch(),
    );
    const [conversacion] = await buscarConversacion('525500002012');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('no_resuelto');
    expect(spyClasificar).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
    spyClasificar.mockRestore();
  });
});

describe('whatsapp.service — menú interactivo inicial (US WA 004)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest
      .spyOn(whatsappConfig, 'messagesUrl')
      .mockReturnValue('https://graph.facebook.com/fake/messages');
    jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('un saludo puro como único mensaje dispara el menú y no llama a Claude (AC1, prueba mínima 1 y 10)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.menu-saludo' }] }),
    });

    const telefono = '5215500002013';
    await postMensaje(`${WAMID_PREFIX}saludo`, telefono, 'hola', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002013');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('menu_enviado');
    expect(spyClasificar).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opciones] = global.fetch.mock.calls[0];
    expect(JSON.parse(opciones.body).type).toBe('interactive');
    const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
    expect(actualizada.estado).toBe('esperando_menu');
    const outboxRows = await db('outbox_whatsapp').where({ conversacion_id: conversacion.id });
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].wamid).toBe('wamid.menu-saludo');

    spyClasificar.mockRestore();
  });

  it('un saludo seguido de una consulta médica no dispara el menú y regresa no_resuelto (AC3/AC4, prueba mínima 4 y 5)', async () => {
    global.fetch = jest.fn();

    const telefono = '5215500002014';
    await postMensaje(
      `${WAMID_PREFIX}saludo-consulta`,
      telefono,
      'hola mi perro está convulsionando',
      ahoraEpoch(),
    );
    const [conversacion] = await buscarConversacion('525500002014');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('no_resuelto');
    expect(global.fetch).not.toHaveBeenCalled();
    // Corrección (encontrada probando en vivo): sin cerrar aquí,
    // formarGrupoParaConversacion reutilizaría ESTE MISMO grupo para
    // siempre en cualquier llamada futura sobre esta conversación,
    // dejando huérfano cualquier mensaje posterior del tutor (nunca
    // vuelve a mirarlos). Cerrar deja el grupo intacto para una futura
    // historia de enrutamiento, pero libera al tutor para empezar una
    // conversación nueva.
    const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
    expect(actualizada.estado).toBe('cerrada');
  });

  it('un comando de menú como primer mensaje de una conversación nueva dispara el menú al vencer la ventana (AC2)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.menu-comando' }] }),
    });

    const telefono = '5215500002015';
    await postMensaje(`${WAMID_PREFIX}comando-nuevo`, telefono, 'menu', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002015');
    // Una conversación NUEVA se queda 'acumulando' (aplicarReglasDeInteraccion
    // solo corre para conversaciones ya existentes) hasta que venza la
    // ventana — es el hook de grupo, no el disparo inmediato, quien la
    // atiende aquí.
    expect(conversacion.estado).toBe('acumulando');
    await vencerConversacion(conversacion.id);

    const resultado = await service.procesarSiguienteConversacionVencida();

    expect(resultado.resultado).toBe('menu_enviado');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
