// US WA 003 — agrupación de mensajes por ventana de inactividad. Necesita
// Postgres real: FOR UPDATE SKIP LOCKED, el reloj de la BD para
// procesar_despues_de, y el índice único parcial de grupos_whatsapp — no
// se puede mockear. Desde US WA 009, un grupo con texto procesable SÍ se
// clasifica (antes terminaba en 'no_resuelto', sin tocar Claude/WhatsApp)
// — claude.clasificarMensaje se mockea a sin_coincidencia (no es el
// interés de este archivo, eso vive en whatsapp.service.test.js) y
// global.fetch/whatsappConfig se mockean para la respuesta de respaldo que
// sale por outbox, mismo criterio que whatsapp.medios.test.js.
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

const originalFetch = global.fetch;
let contadorWamidFake = 0;

beforeAll(() => {
  env.whatsapp.appSecret = APP_SECRET;
  env.whatsapp.webhookVerifyToken = VERIFY_TOKEN;
});

beforeEach(() => {
  // outbox_whatsapp.wamid tiene un índice único real (US WA 015) — un
  // wamid fijo compartido entre pruebas chocaría en cuanto más de una
  // prueba de este archivo de verdad completa un envío (mismo criterio
  // que whatsapp.medios.test.js — el contador NUNCA se reinicia entre
  // pruebas de este archivo).
  global.fetch = jest.fn().mockImplementation(async () => {
    contadorWamidFake += 1;
    return {
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: `wamid.agrup-fake-${contadorWamidFake}` }] }),
    };
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
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
  const alertaIds = await db('alertas_atencion_whatsapp')
    .whereIn('conversacion_id', conversacionIds)
    .pluck('id');
  const outboxAlertasIds = await db('intentos_alerta_whatsapp')
    .whereIn('alerta_id', alertaIds)
    .whereNotNull('outbox_id')
    .pluck('outbox_id');
  await db('intentos_alerta_whatsapp').whereIn('alerta_id', alertaIds).del();
  await db('destinatarios_alerta_whatsapp').whereIn('alerta_id', alertaIds).del();
  await db('alertas_atencion_whatsapp').whereIn('id', alertaIds).del();
  // mensajes_whatsapp referencia grupos_whatsapp Y conversaciones_whatsapp
  // (sin CASCADE) — hay que borrar mensajes primero, luego grupos, luego
  // conversaciones, o las FK truenan.
  // US WA 004: outbox_whatsapp.conversacion_id tiene FK hacia
  // conversaciones_whatsapp — hay que borrar antes que las conversaciones.
  // US WA 009: grupos_whatsapp.intento_envio_id ahora referencia
  // outbox_whatsapp — hay que soltar esa referencia ANTES de borrar
  // outbox_whatsapp, o la FK truena.
  await db('grupos_whatsapp')
    .whereIn('conversacion_id', conversacionIds)
    .update({ intento_envio_id: null });
  await db('emergencias_confirmadas').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('intent_id', outboxAlertasIds).del();
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
    // US WA 009: el texto se clasifica y se responde en la misma ronda
    // (mockeado a sin_coincidencia), así que el grupo termina 'procesado'
    // — lo que AC7/AC9 de esta historia garantiza (y lo que se sigue
    // probando aquí) es que los 5 fragmentos formaron un ÚNICO grupo, no
    // 5 grupos separados.
    expect(grupos[0].estado).toBe('procesado');
    const mensajes = await db('mensajes_whatsapp').where({ group_id: grupos[0].group_id });
    expect(mensajes).toHaveLength(5);
    expect(claude.clasificarMensaje).toHaveBeenCalledTimes(1);
    expect(claude.clasificarMensaje).toHaveBeenCalledWith(
      'uno\ndos\ntres\ncuatro\ncinco',
      expect.any(Array),
      expect.any(Object),
    );
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
    const actualizada = await db('conversaciones_whatsapp').where({ id: conversacion.id }).first();
    expect(actualizada.procesar_despues_de).not.toBeNull();

    await repository.marcarGrupoProcesado(resultado.groupId);
    await repository.finalizarConversacionTrasGrupo(conversacion.id, new Date());
    const rearmada = await db('conversaciones_whatsapp').where({ id: conversacion.id }).first();
    expect(rearmada.estado).toBe('acumulando');
    await vencerConversacion(conversacion.id);
    const segundoGrupo = await service.procesarSiguienteConversacionVencida();
    expect(segundoGrupo.groupId).not.toBe(resultado.groupId);
    expect(segundoGrupo.texto_consolidado).toBe('segundo');
  });

  it('antes de persistir la clasificación incorpora al mismo grupo un fragmento llegado durante Claude', async () => {
    const telefono = '5215500002098';
    await postMensaje(`${WAMID_PREFIX}estabiliza-1`, telefono, 'tiene una bolita', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002098');
    await vencerConversacion(conversacion.id);
    await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });
    const grupo = await repository.formarGrupoParaConversacion(conversacion.id);
    const reclamoId = 'worker-estabiliza';
    await repository.reclamarClasificacionGrupo(grupo.groupId, reclamoId);

    await postMensaje(
      `${WAMID_PREFIX}estabiliza-2`,
      telefono,
      'que le salió en el pecho',
      ahoraEpoch(),
    );

    const incorporado = await db.transaction((trx) =>
      repository.incorporarFragmentosTardiosAlGrupo(trx, {
        conversacionId: conversacion.id,
        groupId: grupo.groupId,
        reclamoId,
      }),
    );

    expect(incorporado).toBe(true);
    const grupoActualizado = await db('grupos_whatsapp').where({ group_id: grupo.groupId }).first();
    expect(grupoActualizado.texto_consolidado).toBe('tiene una bolita\nque le salió en el pecho');
    expect(grupoActualizado.clasificacion_reclamo_id).toBeNull();
    const segundo = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: `${WAMID_PREFIX}estabiliza-2` })
      .first();
    expect(segundo.group_id).toBe(grupo.groupId);
    const conversacionActualizada = await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .first();
    expect(conversacionActualizada.estado).toBe('acumulando');
  });

  it('no envía el respaldo parcial si otro fragmento llega mientras Claude responde', async () => {
    let resolverClaude;
    claude.clasificarMensaje.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolverClaude = resolve;
        }),
    );
    const telefono = '5215500002097';
    await postMensaje(
      `${WAMID_PREFIX}durante-claude-1`,
      telefono,
      'hola, tengo un problema con mi perro',
      ahoraEpoch(),
    );
    const [conversacion] = await buscarConversacion('525500002097');
    await db('conversaciones_whatsapp').where({ id: conversacion.id }).update({
      estado: 'procesando',
      procesamiento_iniciado_en: db.fn.now(),
    });
    const grupo = await repository.formarGrupoParaConversacion(conversacion.id);

    const primeraClasificacion = service.clasificarYResponderGrupo({
      conversacionId: conversacion.id,
      groupId: grupo.groupId,
      textoConsolidado: grupo.texto_consolidado,
      telefono: '525500002097',
    });
    while (claude.clasificarMensaje.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    await postMensaje(
      `${WAMID_PREFIX}durante-claude-2`,
      telefono,
      'tiene una bolita que le salió en el pecho',
      ahoraEpoch(),
    );
    resolverClaude({ etiqueta: null, tokensEntrada: 5, tokensSalida: 1 });

    await expect(primeraClasificacion).resolves.toBe('grupo_reprogramado');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await db('outbox_whatsapp').where({ conversacion_id: conversacion.id })).toHaveLength(0);

    const grupoAmpliado = await db('grupos_whatsapp').where({ group_id: grupo.groupId }).first();
    expect(grupoAmpliado.texto_consolidado).toBe(
      'hola, tengo un problema con mi perro\ntiene una bolita que le salió en el pecho',
    );

    await db('conversaciones_whatsapp').where({ id: conversacion.id }).update({
      estado: 'procesando',
      procesamiento_iniciado_en: db.fn.now(),
    });
    const reintentado = await service.clasificarYResponderGrupo({
      conversacionId: conversacion.id,
      groupId: grupo.groupId,
      textoConsolidado: grupoAmpliado.texto_consolidado,
      telefono: '525500002097',
    });

    expect(reintentado).toBe('clasificado_normal');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await db('outbox_whatsapp').where({ conversacion_id: conversacion.id })).toHaveLength(1);
  });

  it('dos workers solo conceden un lease de clasificación para el mismo grupo (WA009 AC27)', async () => {
    const telefono = '5215500002099';
    await postMensaje(`${WAMID_PREFIX}lease-clasificacion`, telefono, 'consulta', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002099');
    await vencerConversacion(conversacion.id);
    await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });
    const grupo = await repository.formarGrupoParaConversacion(conversacion.id);

    const [a, b] = await Promise.all([
      repository.reclamarClasificacionGrupo(grupo.groupId, 'worker-a'),
      repository.reclamarClasificacionGrupo(grupo.groupId, 'worker-b'),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
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

  it('la FORMACIÓN del grupo en sí (esta historia, US WA 003) nunca llama a Claude ni a WhatsApp (AC9/AC15)', async () => {
    // US WA 009 conectó el grupo consolidado con Claude — pero eso vive en
    // whatsapp.service.js#clasificarYResponderGrupo, un paso SEPARADO que
    // ocurre DESPUÉS de formarGrupoParaConversacion (esta función). Lo que
    // AC9/AC15 de US WA 003 garantizan es que la formación del grupo en sí
    // — el alcance real de esta historia — es 100% determinista y nunca
    // toca la red; se prueba aquí llamando directo al repository, sin
    // pasar por el pipeline completo de procesarSiguienteConversacionVencida
    // (que si acepta el texto).
    const telefono = '5215500002012';
    await postMensaje(
      `${WAMID_PREFIX}sinclaude`,
      telefono,
      'mi perro no quiere comer',
      ahoraEpoch(),
    );
    const [conversacion] = await buscarConversacion('525500002012');
    await vencerConversacion(conversacion.id);
    await repository.reclamarConversacionVencida({ segundosRecuperacion: 120 });

    const resultado = await repository.formarGrupoParaConversacion(conversacion.id);

    expect(resultado.tieneTextoProcesable).toBe(true);
    expect(claude.clasificarMensaje).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
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
    const grupo = await db('grupos_whatsapp').where({ group_id: resultado.groupId }).first();
    expect(grupo).toMatchObject({
      ruta_enrutamiento: 'saludo_puro',
      intencion_resuelta: 'mostrar_menu_principal',
      resultado_decision: 'menu_principal',
      tokens_entrada: 0,
      tokens_salida: 0,
      intento_envio_id: outboxRows[0].intent_id,
    });
    expect(grupo.enrutado_en).not.toBeNull();

    spyClasificar.mockRestore();
  });

  it('un saludo seguido de una consulta médica no dispara el menú — se clasifica normalmente (AC3/AC4, prueba mínima 4 y 5; antes "no_resuelto")', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.saludo-consulta' }] }),
    });

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

    // AC3/AC4 de US WA 004: el prefijo "hola" no confunde la detección de
    // saludo puro — nunca se dispara el menú. US WA 009 conectó lo que
    // pasa después: en vez de quedar 'no_resuelto', el texto completo se
    // clasifica con Claude (mockeado a sin_coincidencia) igual que
    // cualquier otro texto libre.
    expect(claude.clasificarMensaje).toHaveBeenCalledWith(
      'hola mi perro está convulsionando',
      expect.any(Array),
      expect.any(Object),
    );
    expect(resultado.resultado).toBe('clasificado_normal');
    // Cierra la conversación tras responder (mismo criterio que "no_resuelto"
    // cerraba antes) — libera al tutor para empezar una conversación nueva.
    const [actualizada] = await db('conversaciones_whatsapp').where({ id: conversacion.id });
    expect(actualizada.estado).toBe('cerrada');
    const grupo = await db('grupos_whatsapp').where({ group_id: resultado.groupId }).first();
    expect(grupo).toMatchObject({
      ruta_enrutamiento: 'consulta_libre',
      categoria_resuelta: 'sin_coincidencia',
      intencion_resuelta: 'sin_coincidencia_default',
      resultado_decision: 'plantilla_respaldo',
      slug_resuelto: 'sin-coincidencia-default',
      tokens_entrada: 0,
      tokens_salida: 0,
    });
  });

  it('WA011: un fallo de Claude persiste el respaldo y un reintento no vuelve a clasificar', async () => {
    claude.clasificarMensaje.mockRejectedValueOnce(
      Object.assign(new Error('timeout simulado'), { code: 'CLAUDE_TIMEOUT' }),
    );
    const telefono = '5215500002199';
    await postMensaje(
      `${WAMID_PREFIX}claude-falla-controlada`,
      telefono,
      'necesito orientación',
      ahoraEpoch(),
    );
    const [conversacion] = await buscarConversacion('525500002199');
    await vencerConversacion(conversacion.id);

    const primero = await service.procesarSiguienteConversacionVencida();
    expect(primero.resultado).toBe('clasificado_normal');

    const grupo = await db('grupos_whatsapp').where({ group_id: primero.groupId }).first();
    expect(grupo).toMatchObject({
      ruta_enrutamiento: 'consulta_libre',
      categoria_resuelta: 'sin_coincidencia',
      resultado_decision: 'plantilla_respaldo',
      slug_resuelto: 'sin-coincidencia-default',
      tokens_entrada: 0,
      tokens_salida: 0,
    });
    expect(grupo.clasificado_en).not.toBeNull();

    await service.clasificarYResponderGrupo({
      conversacionId: conversacion.id,
      groupId: primero.groupId,
      textoConsolidado: primero.texto_consolidado,
      telefono: '525500002199',
    });
    expect(claude.clasificarMensaje).toHaveBeenCalledTimes(1);
  });

  it('un comando de menú como primer mensaje dispara el menú inmediatamente (AC2)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.menu-comando' }] }),
    });

    const telefono = '5215500002015';
    await postMensaje(`${WAMID_PREFIX}comando-nuevo`, telefono, 'menu', ahoraEpoch());
    const [conversacion] = await buscarConversacion('525500002015');
    expect(conversacion.estado).toBe('esperando_menu');
    expect(conversacion.procesar_despues_de).toBeNull();

    const mensaje = await db('mensajes_whatsapp')
      .where({ whatsapp_message_id: `${WAMID_PREFIX}comando-nuevo` })
      .first();
    let intento;
    for (let i = 0; i < 100 && intento?.estado !== 'enviado'; i += 1) {
      intento = await db('outbox_whatsapp')
        .where({ clave_idempotencia: `mensaje:${mensaje.id}:menu` })
        .first();
      if (intento?.estado !== 'enviado') {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    expect(mensaje.estado_procesamiento).toBe('procesado');
    expect(mensaje.group_id).toBeNull();
    expect(intento?.estado).toBe('enviado');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await db('grupos_whatsapp').where({ conversacion_id: conversacion.id })).toHaveLength(0);
  });
});
