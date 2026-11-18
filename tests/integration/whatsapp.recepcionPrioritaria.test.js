const db = require('../../src/config/database');
const whatsapp = require('../../src/config/whatsapp');
const claude = require('../../src/config/claude');
const configuracion = require('../../src/modules/configuracion/configuracion.service');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');
const atencion = require('../../src/modules/whatsapp/whatsapp.atencionHumana.service');
const menu = require('../../src/modules/whatsapp/whatsapp.menu');

const PHONE_ID = 'phone-recepcion-prioritaria-test';
const FUNCIONES = {
  respuestasAutomaticas: true,
  citasConsultas: true,
  citasEstetica: true,
  avisoPrivacidad: false,
};
const originalFetch = global.fetch;
let secuencia = 0;

function respuestaMeta() {
  return {
    ok: true,
    json: async () => ({ messages: [{ id: `wamid.recepcion-prioritaria-${++secuencia}` }] }),
  };
}

function evento(
  telefono,
  contenido,
  tipoMensaje = 'text',
  whatsappMessageId = `wamid.recepcion-entrante-${++secuencia}`,
) {
  return {
    whatsappMessageId,
    from: telefono,
    phoneNumberId: PHONE_ID,
    contenido,
    tipoMensaje,
    tituloInteractivo: tipoMensaje === 'interactive_list_reply' ? 'Recepción' : null,
    timestamp: String(Math.floor(Date.now() / 1000)),
    funcionesWhatsapp: FUNCIONES,
  };
}

async function preparar({ estado = 'procesando', conMenu = true, cambios = {} } = {}) {
  const telefono = `52550066${String(++secuencia).padStart(4, '0')}`;
  const [c] = await db('conversaciones_whatsapp')
    .insert({
      phone_number_id: PHONE_ID,
      telefono_normalizado: telefono,
      estado: 'esperando_menu',
      primer_fragmento_en: new Date(),
      ultima_interaccion_en: new Date(),
    })
    .returning('*');
  if (conMenu)
    await service.enviarMenuPrincipal({
      conversacionId: c.id,
      telefono,
      claveBase: `repro-recepcion:${c.id}`,
    });
  await service.registrarEventoEntrante(evento(telefono, 'hola, tengo una consulta'));
  const grupo = await repository.formarGrupoParaConversacion(c.id);
  await db('conversaciones_whatsapp')
    .where({ id: c.id })
    .update({ estado, procesamiento_iniciado_en: db.fn.now(), ...cambios });
  global.fetch.mockClear();
  return { c, telefono, grupo };
}

async function intentarRespuestaPendiente(c, telefono, estado = 'pendiente') {
  const { intent } = await outbox.registrarIntento({
    claveIdempotencia: `repro-recepcion:${c.id}:respuesta:${estado}`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId: c.id,
    destinatarioTelefono: telefono,
    payloadFuncional: { tipo: 'text', destinatarioTelefono: telefono, texto: 'Respuesta anterior' },
    usaPlantilla: false,
  });
  if (estado !== 'pendiente')
    await db('outbox_whatsapp').where({ intent_id: intent.intent_id }).update({ estado });
  return intent;
}

beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async () => respuestaMeta());
  jest.spyOn(whatsapp, 'messagesUrl').mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsapp, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
  jest.spyOn(configuracion, 'obtenerConfiguracionWhatsapp').mockResolvedValue(FUNCIONES);
  jest
    .spyOn(claude, 'clasificarMensaje')
    .mockResolvedValue({ etiqueta: null, tokensEntrada: 0, tokensSalida: 0 });
});

afterEach(async () => {
  const ids = await db('conversaciones_whatsapp').where('phone_number_id', PHONE_ID).pluck('id');
  const alertas = await db('alertas_atencion_whatsapp').whereIn('conversacion_id', ids).pluck('id');
  const outboxAlertas = await db('intentos_alerta_whatsapp')
    .whereIn('alerta_id', alertas)
    .whereNotNull('outbox_id')
    .pluck('outbox_id');
  await db('intentos_alerta_whatsapp').whereIn('alerta_id', alertas).del();
  await db('destinatarios_alerta_whatsapp').whereIn('alerta_id', alertas).del();
  await db('alertas_atencion_whatsapp').whereIn('id', alertas).del();
  await db('solicitudes_atencion_humana').whereIn('conversacion_id', ids).del();
  await db('emergencias_confirmadas').whereIn('conversacion_id', ids).del();
  await db('conversaciones_whatsapp').whereIn('id', ids).update({ grupo_medio_pendiente_id: null });
  await db('grupos_whatsapp').whereIn('conversacion_id', ids).update({ intento_envio_id: null });
  await db('outbox_whatsapp').whereIn('conversacion_id', ids).del();
  await db('outbox_whatsapp').whereIn('intent_id', outboxAlertas).del();
  await db('mensajes_whatsapp').whereIn('conversacion_id', ids).del();
  await db('grupos_whatsapp').whereIn('conversacion_id', ids).del();
  await db('eventos_metricas_whatsapp').whereIn('conversacion_id', ids).del();
  await db('conversaciones_whatsapp').whereIn('id', ids).del();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});
afterAll(async () => db.destroy());

it.each(['acumulando', 'procesando'])(
  'prioriza Recepción durante %s, cancela respuestas pendientes y conserva la transferencia',
  async (estado) => {
    const { c, telefono, grupo } = await preparar({ estado });
    const pendiente = await intentarRespuestaPendiente(c, telefono);
    const fallido = await intentarRespuestaPendiente(c, telefono, 'fallido');
    const boton = evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply');
    const recibido = await service.registrarEventoEntrante(boton);
    expect(recibido).toMatchObject({ rutaResuelta: 'recepcion', seleccionInvalida: false });
    const actual = await db('conversaciones_whatsapp').where({ id: c.id }).first();
    expect(actual.recepcion_prioritaria_en).not.toBeNull();
    expect(actual.menu_principal_vigente_en).toBeNull();
    expect(actual.procesar_despues_de).toBeNull();
    expect((await repository.buscarIntentoPorClave(pendiente.clave_idempotencia)).estado).toBe(
      'cancelado',
    );
    expect((await repository.buscarIntentoPorClave(fallido.clave_idempotencia)).estado).toBe(
      'cancelado',
    );
    expect(
      (await db('grupos_whatsapp').where({ group_id: grupo.groupId }).first()).resultado_decision,
    ).toBe('interrumpido_por_recepcion');
    expect(await repository.finalizarConversacionTrasGrupo(c.id, new Date())).toBe(false);
    expect(await repository.confirmarMenuEnviado(c.id)).toBe(false);
    expect(await repository.confirmarEnlaceAgendaEnviado(c.id, new Date())).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    await service.registrarEventoEntrante(boton);
    expect(await db('solicitudes_atencion_humana').where({ conversacion_id: c.id })).toHaveLength(
      1,
    );
    expect(await db('alertas_atencion_whatsapp').where({ conversacion_id: c.id })).toHaveLength(1);
    const siguiente = await service.registrarEventoEntrante(evento(telefono, 'otro mensaje'));
    expect(siguiente.rutaResuelta).toBeNull();
    expect(
      (await db('mensajes_whatsapp').where({ id: siguiente.id }).first()).estado_procesamiento,
    ).toBe('ignorado_atencion_humana');
    const transferida = await atencion.procesarSiguienteSolicitudPendiente();
    expect(transferida.resultado).toBe('enviada');
    expect((await db('conversaciones_whatsapp').where({ id: c.id }).first()).estado).toBe(
      'atencion_humana',
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).text.body).toBe(
      atencion.TEXTO_TRANSFERENCIA,
    );
  },
);

it('descarta la respuesta de Claude si Recepción se solicita mientras clasifica', async () => {
  const { c, telefono, grupo } = await preparar();
  let resolverClaude;
  let avisarInicio;
  const inicio = new Promise((resolve) => {
    avisarInicio = resolve;
  });
  claude.clasificarMensaje.mockImplementationOnce(() => {
    avisarInicio();
    return new Promise((resolve) => {
      resolverClaude = resolve;
    });
  });
  const clasificacion = service.clasificarYResponderGrupo({
    conversacionId: c.id,
    groupId: grupo.groupId,
    textoConsolidado: grupo.texto_consolidado,
    telefono,
  });
  await inicio;
  await service.registrarEventoEntrante(
    evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply'),
  );
  resolverClaude({ etiqueta: null, tokensEntrada: 5, tokensSalida: 1 });
  expect(await clasificacion).toBe('interrumpido_por_recepcion');
  expect(global.fetch).not.toHaveBeenCalled();
  expect(
    await repository.buscarIntentoPorClave(`grupo:${grupo.groupId}:respuesta`),
  ).toBeUndefined();
  const original = await db('grupos_whatsapp').where({ group_id: grupo.groupId }).first();
  expect(original).toMatchObject({
    resultado_decision: 'interrumpido_por_recepcion',
    clasificado_en: null,
    llamadas_claude: 1,
    tokens_entrada: 5,
  });
});

it('bloquea una respuesta ya reclamada si Recepción llega antes de iniciar la petición a Meta', async () => {
  const { c, telefono } = await preparar();
  const intent = await intentarRespuestaPendiente(c, telefono);
  let continuar;
  let avisarInicio;
  const inicio = new Promise((resolve) => {
    avisarInicio = resolve;
  });
  jest.spyOn(repository, 'estaVentanaServicioVencida').mockImplementationOnce(() => {
    avisarInicio();
    return new Promise((resolve) => {
      continuar = resolve;
    });
  });
  const envio = outbox.ejecutarIntento(intent.clave_idempotencia);
  await inicio;
  await service.registrarEventoEntrante(
    evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply'),
  );
  continuar(false);
  expect(await envio).toEqual({ enviado: false, motivo: 'recepcion_prioritaria' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect((await repository.buscarIntentoPorClave(intent.clave_idempotencia)).estado).toBe(
    'cancelado',
  );
});

it('espera una selección que está confirmándose en otra transacción antes de iniciar el envío', async () => {
  const { c, telefono } = await preparar();
  const intent = await intentarRespuestaPendiente(c, telefono);
  const comprobarPrioridad = repository.tieneRecepcionPrioritaria;
  let avisarComprobacion;
  const comprobacion = new Promise((resolve) => {
    avisarComprobacion = resolve;
  });
  jest.spyOn(repository, 'tieneRecepcionPrioritaria').mockImplementation((...args) => {
    avisarComprobacion();
    return comprobarPrioridad(...args);
  });
  let envio;
  await db.transaction(async (trx) => {
    await trx('conversaciones_whatsapp')
      .where({ id: c.id })
      .update({ recepcion_prioritaria_en: trx.fn.now() });
    envio = outbox.ejecutarIntento(intent.clave_idempotencia);
    await comprobacion;
  });
  expect(await envio).toEqual({ enviado: false, motivo: 'recepcion_prioritaria' });
  expect(global.fetch).not.toHaveBeenCalled();
});

it('una respuesta ya en vuelo puede completarse, pero no cierra ni altera la prioridad de Recepción', async () => {
  const { c, telefono, grupo } = await preparar();
  let responderMeta;
  let avisarInicio;
  const inicio = new Promise((resolve) => {
    avisarInicio = resolve;
  });
  global.fetch.mockImplementationOnce(() => {
    avisarInicio();
    return new Promise((resolve) => {
      responderMeta = resolve;
    });
  });
  const clasificacion = service.clasificarYResponderGrupo({
    conversacionId: c.id,
    groupId: grupo.groupId,
    textoConsolidado: grupo.texto_consolidado,
    telefono,
  });
  await inicio;
  await service.registrarEventoEntrante(
    evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply'),
  );
  responderMeta(respuestaMeta());
  expect(await clasificacion).toBe('respuesta_en_vuelo_recepcion_prioritaria');
  const actual = await db('conversaciones_whatsapp').where({ id: c.id }).first();
  expect(actual.estado).not.toBe('cerrada');
  expect(actual.recepcion_prioritaria_en).not.toBeNull();
  const original = await repository.buscarIntentoPorClave(`grupo:${grupo.groupId}:respuesta`);
  expect(original.estado).toBe('enviado');
  expect(original.wamid).not.toBeNull();
});

it.each([
  ['sin menú enviado', { conMenu: false }],
  [
    'flujo activo',
    {
      cambios: {
        estado: 'flujo_activo',
        flujo_actual: 'explicacion_medio',
        paso_actual: 'esperando_descripcion',
      },
    },
  ],
])('rechaza Recepción desde un menú que no está vigente: %s', async (_nombre, opciones) => {
  const { c, telefono } = await preparar(opciones);
  const recibido = await service.registrarEventoEntrante(
    evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply'),
  );
  expect(recibido.seleccionInvalida).toBe(true);
  expect(recibido.rutaResuelta).toBeNull();
  expect(await repository.tieneRecepcionPrioritaria(c.id)).toBe(false);
  expect(await db('solicitudes_atencion_humana').where({ conversacion_id: c.id })).toHaveLength(0);
});

it('menú reactiva una conversación nueva después de la atención humana y permite otra transferencia', async () => {
  const { c, telefono } = await preparar();
  await service.registrarEventoEntrante(
    evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply'),
  );
  await atencion.procesarSiguienteSolicitudPendiente();
  const reactivada = await service.registrarEventoEntrante(evento(telefono, 'menú'));
  expect(reactivada.conversacionId).not.toBe(c.id);
  await service.enviarMenuPrincipal({
    conversacionId: reactivada.conversacionId,
    telefono,
    claveBase: `reactivada:${reactivada.conversacionId}`,
  });
  const nueva = await db('conversaciones_whatsapp')
    .where({ id: reactivada.conversacionId })
    .first();
  expect(nueva.estado).toBe('esperando_menu');
  expect(nueva.menu_principal_vigente_en).not.toBeNull();
  expect(nueva.recepcion_prioritaria_en).toBeNull();
  const recepcion = await service.registrarEventoEntrante(
    evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply'),
  );
  expect(recepcion.rutaResuelta).toBe('recepcion');
  expect(
    await db('solicitudes_atencion_humana').whereIn('conversacion_id', [c.id, nueva.id]),
  ).toHaveLength(2);
});

it.each([
  ['identificador desconocido', 'MENU_INVENTADO', 'interactive_list_reply'],
  ['otra opción durante clasificación', menu.MENU_AGENDAR_ESTETICA, 'interactive_list_reply'],
  ['recepción escrita como texto', 'recepción', 'text'],
])('la prioridad no se concede a %s', async (_nombre, contenido, tipo) => {
  const { c, telefono } = await preparar();
  const recibido = await service.registrarEventoEntrante(evento(telefono, contenido, tipo));
  expect(recibido.rutaResuelta).not.toBe('recepcion');
  expect(await repository.tieneRecepcionPrioritaria(c.id)).toBe(false);
  expect(await db('solicitudes_atencion_humana').where({ conversacion_id: c.id })).toHaveLength(0);
});

it('si falta enviar el aviso de transferencia, el reinicio conserva la prioridad y el aviso se reintenta', async () => {
  const { c, telefono } = await preparar();
  await service.registrarEventoEntrante(
    evento(telefono, menu.MENU_RECEPCION, 'interactive_list_reply'),
  );
  global.fetch.mockRejectedValueOnce(new Error('Red no disponible'));
  expect((await atencion.procesarSiguienteSolicitudPendiente()).resultado).toBe(
    'fallida_reintentable',
  );
  // La prioridad se vuelve a consultar en BD, sin depender de memoria del proceso.
  expect(await repository.tieneRecepcionPrioritaria(c.id)).toBe(true);
  expect(await repository.confirmarEmergenciaSolicitada(c.id)).toBe(false);
  expect(await repository.confirmarGuiaMedioEnviada(c.id, 0)).toBe(false);
  expect(await repository.finalizarConversacionTrasGrupo(c.id, new Date())).toBe(false);
  await db('solicitudes_atencion_humana')
    .where({ conversacion_id: c.id })
    .update({ reintentar_despues_de: db.fn.now() });
  expect((await atencion.procesarSiguienteSolicitudPendiente()).resultado).toBe('enviada');
  expect((await db('conversaciones_whatsapp').where({ id: c.id }).first()).estado).toBe(
    'atencion_humana',
  );
});
