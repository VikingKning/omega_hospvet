const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/database');
const { store: sessionStore } = require('../../src/config/session');
const whatsappConfig = require('../../src/config/whatsapp');
const claude = require('../../src/config/claude');
const service = require('../../src/modules/whatsapp/whatsapp.alertas.service');
const repository = require('../../src/modules/whatsapp/whatsapp.alertas.repository');

const PHONE_NUMBER_ID = 'phone-integ-alertas-wa018';
const USER_PREFIX = 'wa018.';
const originalFetch = global.fetch;
let secuencia = 0;
let usuariosPreviosConAlertas = [];

async function limpiarDatos() {
  const conversaciones = await db('conversaciones_whatsapp')
    .where({ phone_number_id: PHONE_NUMBER_ID })
    .pluck('id');
  const alertas = conversaciones.length
    ? await db('alertas_atencion_whatsapp').whereIn('conversacion_id', conversaciones).pluck('id')
    : [];
  const outboxIds = alertas.length
    ? await db('intentos_alerta_whatsapp').whereIn('alerta_id', alertas).pluck('outbox_id')
    : [];
  if (alertas.length) {
    await db('intentos_alerta_whatsapp').whereIn('alerta_id', alertas).del();
    await db('destinatarios_alerta_whatsapp').whereIn('alerta_id', alertas).del();
    await db('alertas_atencion_whatsapp').whereIn('id', alertas).del();
  }
  if (outboxIds.filter(Boolean).length) {
    await db('outbox_whatsapp').whereIn('intent_id', outboxIds.filter(Boolean)).del();
  }
  if (conversaciones.length) {
    await db('conversaciones_whatsapp').whereIn('id', conversaciones).del();
  }
  await db('usuarios').where('username', 'like', `${USER_PREFIX}%`).del();
}

beforeAll(async () => {
  await limpiarDatos();
  usuariosPreviosConAlertas = await db('usuarios')
    .where({ notificaciones_alertas: true })
    .select('id', 'notificaciones_alertas');
  if (usuariosPreviosConAlertas.length) {
    await db('usuarios')
      .whereIn(
        'id',
        usuariosPreviosConAlertas.map((usuario) => usuario.id),
      )
      .update({ notificaciones_alertas: false });
  }
});

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages: [{ id: `wamid.wa018-${Date.now()}` }] }),
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
});

afterEach(async () => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  await limpiarDatos();
});

afterAll(async () => {
  if (usuariosPreviosConAlertas.length) {
    await db('usuarios')
      .whereIn(
        'id',
        usuariosPreviosConAlertas.map((usuario) => usuario.id),
      )
      .update({ notificaciones_alertas: true });
  }
  await Promise.all([db.destroy(), sessionStore.close()]);
});

async function crearUsuario(tipoUsuario, overrides = {}) {
  secuencia += 1;
  const username = `${USER_PREFIX}${secuencia}`;
  const { password = 'Password-Seguro-WA018!', ...columnas } = overrides;
  const [usuario] = await db('usuarios')
    .insert({
      nombre: 'Usuario',
      apellidos: `WA018 ${secuencia}`,
      correo: `${username}@omega.test`,
      telefono: `77116${String(secuencia).padStart(5, '0')}`,
      username,
      password_hash: await bcrypt.hash(password, 4),
      estatus: 'activo',
      tipo_usuario: tipoUsuario,
      notificaciones_alertas: true,
      creado_en: db.fn.now(),
      ...columnas,
    })
    .returning('*');
  return usuario;
}

async function crearConversacion(overrides = {}) {
  secuencia += 1;
  const ahora = new Date();
  const [conversacion] = await db('conversaciones_whatsapp')
    .insert({
      phone_number_id: PHONE_NUMBER_ID,
      telefono_normalizado: `525599${String(secuencia).padStart(6, '0')}`,
      estado: 'atencion_humana',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
      atencion_humana_desde: ahora,
      atencion_humana_hasta: new Date(ahora.getTime() + 5 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning('*');
  return conversacion;
}

async function crearAlerta(tipoAlerta, clave, conversacion) {
  return service.solicitarAlerta({
    claveIdempotencia: clave,
    tipoAlerta,
    conversacionId: conversacion.id,
    telefonoExterno: conversacion.telefono_normalizado,
    origen: tipoAlerta,
  });
}

async function csrfInicial(agent) {
  const pagina = await agent.get('/');
  return pagina.text.match(/id="csrfToken" value="([^"]+)"/)[1];
}

describe('US WA 018 — selección inicial, persistencia e idempotencia', () => {
  it('conserva una solicitud WA019 pendiente si falla temporalmente la resolución WA018', async () => {
    const recepcion = await crearUsuario('recepcion');
    const conversacion = await crearConversacion();
    const registrada = await service.registrarSolicitudAlerta({
      claveIdempotencia: 'wa019:recepcion:fallo-temporal',
      tipoAlerta: 'recepcion',
      conversacionId: conversacion.id,
      telefonoExterno: conversacion.telefono_normalizado,
      origen: 'menu_recepcion',
    });
    const fallo = jest
      .spyOn(repository, 'resolverUsuarios')
      .mockRejectedValueOnce(new Error('Base de usuarios temporalmente no disponible'));

    await expect(service.listarPendientes(recepcion.id)).resolves.toEqual([]);

    await expect(service.procesarSiguienteAlertaPendiente()).rejects.toThrow(
      'Base de usuarios temporalmente no disponible',
    );
    await expect(
      db('alertas_atencion_whatsapp').where({ id: registrada.alerta.id }).first(),
    ).resolves.toMatchObject({
      estado: 'pendiente',
      resolucion_destinatarios: 'pendiente',
      origen: 'menu_recepcion',
    });

    fallo.mockRestore();
    await expect(service.procesarSiguienteAlertaPendiente()).resolves.toMatchObject({
      alerta: { id: registrada.alerta.id, resolucion_destinatarios: 'principal' },
    });
    await expect(service.listarPendientes(recepcion.id)).resolves.toEqual([
      expect.objectContaining({ id: registrada.alerta.id, tipo: 'recepcion' }),
    ]);
  });

  it('selecciona únicamente doctores elegibles, no agrega admin y deduplica el teléfono', async () => {
    const telefonoCompartido = '7711634578';
    const doctor1 = await crearUsuario('doctor', { telefono: telefonoCompartido });
    const doctor2 = await crearUsuario('doctor', { telefono: telefonoCompartido });
    const doctorSinTelefono = await crearUsuario('doctor', { telefono: null });
    const doctorTelefonoInvalido = await crearUsuario('doctor', { telefono: '123' });
    await crearUsuario('doctor', { estatus: 'bloqueado' });
    await crearUsuario('doctor', { notificaciones_alertas: false });
    await crearUsuario('recepcion');
    const admin = await crearUsuario('admin');
    const conversacion = await crearConversacion();
    const spyClaude = jest.spyOn(claude, 'clasificarMensaje');

    const primera = await crearAlerta('emergencia', 'wa018:emergencia:1', conversacion);

    expect(primera.alerta.resolucion_destinatarios).toBe('principal');
    expect(primera.destinatarios.map((fila) => fila.usuario_id)).toEqual([
      doctor1.id,
      doctor2.id,
      doctorSinTelefono.id,
      doctorTelefonoInvalido.id,
    ]);
    expect(primera.destinatarios.some((fila) => fila.usuario_id === admin.id)).toBe(false);
    expect(spyClaude).not.toHaveBeenCalled();

    const intentos = await db('intentos_alerta_whatsapp').where({ alerta_id: primera.alerta.id });
    expect(intentos.filter((fila) => fila.canal === 'portal')).toHaveLength(4);
    expect(intentos.filter((fila) => fila.canal === 'navegador')).toHaveLength(4);
    expect(
      intentos.filter(
        (fila) => fila.canal === 'whatsapp' && fila.destino_normalizado === '527711634578',
      ),
    ).toHaveLength(1);
    expect(
      intentos.filter((fila) => fila.canal === 'whatsapp' && fila.estado === 'no_aplicable'),
    ).toHaveLength(2);

    await db('usuarios').where({ id: doctor1.id }).update({ notificaciones_alertas: false });
    const nuevoDoctor = await crearUsuario('doctor');
    const repetida = await crearAlerta('emergencia', 'wa018:emergencia:1', conversacion);
    expect(repetida.esNueva).toBe(false);
    const seleccionPersistida = await db('destinatarios_alerta_whatsapp')
      .where({ alerta_id: primera.alerta.id })
      .pluck('usuario_id');
    expect(seleccionPersistida).toHaveLength(4);
    expect(seleccionPersistida).not.toContain(nuevoDoctor.id);
    await expect(
      db('outbox_whatsapp').where('clave_idempotencia', 'like', `alerta:${primera.alerta.id}:%`),
    ).resolves.toHaveLength(1);
  });

  it('usa administradores solo como respaldo y conserva pendiente una alerta sin destinatarios', async () => {
    await crearUsuario('recepcion', { estatus: 'inactivo' });
    const admin = await crearUsuario('admin');
    const conversacion = await crearConversacion();

    const respaldo = await crearAlerta('recepcion', 'wa018:recepcion:1', conversacion);
    expect(respaldo.alerta.resolucion_destinatarios).toBe('respaldo_admin');
    expect(respaldo.destinatarios).toHaveLength(1);
    expect(respaldo.destinatarios[0]).toMatchObject({
      usuario_id: admin.id,
      tipo_usuario: 'admin',
      es_respaldo_admin: true,
    });

    await db('usuarios').where({ id: admin.id }).update({ notificaciones_alertas: false });
    const otraConversacion = await crearConversacion();
    const sinDestinatarios = await crearAlerta(
      'recepcion',
      'wa018:recepcion:sin-destinatarios',
      otraConversacion,
    );
    expect(sinDestinatarios.alerta).toMatchObject({
      estado: 'pendiente',
      resolucion_destinatarios: 'sin_destinatarios',
    });
    expect(sinDestinatarios.destinatarios).toHaveLength(0);
  });
});

describe('US WA 018 — canales y auditoría', () => {
  it('envía por outbox una plantilla interna aprobable y registra el resultado independiente', async () => {
    await crearUsuario('doctor', { telefono: '7711634578' });
    const conversacion = await crearConversacion();
    const { alerta } = await crearAlerta('emergencia', 'wa018:envio:1', conversacion);

    const procesado = await service.procesarSiguienteEnvioWhatsapp();

    expect(procesado.resultado).toBe('enviado');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      to: '527711634578',
      type: 'template',
      template: { name: 'alerta_emergencia_personal_v1', language: { code: 'es_MX' } },
    });
    const auditoria = await db('intentos_alerta_whatsapp').where({ alerta_id: alerta.id });
    expect(auditoria.find((fila) => fila.canal === 'whatsapp')).toMatchObject({
      estado: 'enviado',
      numero_intento: 1,
    });
    expect(auditoria.filter((fila) => fila.canal === 'portal')).toHaveLength(1);
    expect(auditoria.filter((fila) => fila.canal === 'navegador')).toHaveLength(1);
  });

  it('un fallo de WhatsApp no atiende la alerta ni sobrescribe los otros canales', async () => {
    await crearUsuario('recepcion');
    const conversacion = await crearConversacion();
    const { alerta } = await crearAlerta('recepcion', 'wa018:envio-fallido:1', conversacion);
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'Plantilla no disponible' } }),
    });

    await service.procesarSiguienteEnvioWhatsapp();

    await expect(
      db('alertas_atencion_whatsapp').where({ id: alerta.id }).first(),
    ).resolves.toMatchObject({ estado: 'pendiente' });
    const intentos = await db('intentos_alerta_whatsapp').where({ alerta_id: alerta.id });
    expect(intentos.find((fila) => fila.canal === 'whatsapp')).toMatchObject({
      estado: 'fallido',
      numero_intento: 1,
    });
    expect(intentos.find((fila) => fila.canal === 'portal').estado).toBe('pendiente');
    expect(intentos.find((fila) => fila.canal === 'navegador').estado).toBe('pendiente');
  });

  it('recupera un intento funcional abandonado sin duplicar el outbox', async () => {
    await crearUsuario('doctor', { telefono: '7711634578' });
    const conversacion = await crearConversacion();
    const { alerta } = await crearAlerta('emergencia', 'wa018:envio-huerfano:1', conversacion);
    const intento = await db('intentos_alerta_whatsapp')
      .where({ alerta_id: alerta.id, canal: 'whatsapp' })
      .first();
    await db('intentos_alerta_whatsapp')
      .where({ id: intento.id })
      .update({
        estado: 'enviando',
        numero_intento: 1,
        intentado_en: new Date(Date.now() - 10 * 60 * 1000),
      });

    await expect(service.procesarSiguienteEnvioWhatsapp()).resolves.toMatchObject({
      id: intento.id,
      resultado: 'enviado',
    });
    await expect(
      db('intentos_alerta_whatsapp').where({ id: intento.id }).first(),
    ).resolves.toMatchObject({ estado: 'enviado', numero_intento: 2 });
    await expect(
      db('outbox_whatsapp').where({ clave_idempotencia: intento.clave_idempotencia }),
    ).resolves.toHaveLength(1);
  });
});

describe('US WA 018 — portal, autorización vigente y atención concurrente', () => {
  it('muestra la alerta al iniciar sesión, audita navegador y permite Atender sin tocar la conversación', async () => {
    const password = 'Password-Seguro-WA018!';
    const doctor = await crearUsuario('doctor', { password });
    const haceSeisHoras = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const conversacion = await crearConversacion({
      atencion_humana_desde: haceSeisHoras,
      atencion_humana_hasta: new Date(haceSeisHoras.getTime() + 5 * 60 * 60 * 1000),
    });
    const { alerta } = await crearAlerta('emergencia', 'wa018:portal:1', conversacion);
    const agent = request.agent(app);
    const csrfLogin = await csrfInicial(agent);
    await agent
      .post('/login')
      .set('x-csrf-token', csrfLogin)
      .send({ username: doctor.username, password })
      .expect(200);

    const listado = await agent.get('/api/whatsapp/alertas').expect(200);
    expect(listado.body.alertas).toEqual([
      expect.objectContaining({ id: alerta.id, tipo: 'emergencia' }),
    ]);
    await expect(
      db('intentos_alerta_whatsapp').where({ alerta_id: alerta.id, canal: 'portal' }).first(),
    ).resolves.toMatchObject({ estado: 'enviado' });

    await agent
      .post(`/api/whatsapp/alertas/${alerta.id}/navegador`)
      .set('x-csrf-token', listado.body.csrfToken)
      .send({ estado: 'no_disponible', error: 'Permiso revocado' })
      .expect(200);
    const conversacionAntes = await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .first();
    await agent
      .post(`/api/whatsapp/alertas/${alerta.id}/atender`)
      .set('x-csrf-token', listado.body.csrfToken)
      .send({})
      .expect(200);

    await expect(
      db('alertas_atencion_whatsapp').where({ id: alerta.id }).first(),
    ).resolves.toMatchObject({ estado: 'atendida', atendida_por: doctor.id });
    const conversacionDespues = await db('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .first();
    expect(conversacionDespues.atencion_humana_desde).toEqual(
      conversacionAntes.atencion_humana_desde,
    );
    expect(conversacionDespues.atencion_humana_hasta).toEqual(
      conversacionAntes.atencion_humana_hasta,
    );
    expect(global.fetch).not.toHaveBeenCalled();
    await expect(agent.get('/api/whatsapp/alertas')).resolves.toMatchObject({
      status: 200,
      body: { alertas: [] },
    });
  });

  it('revoca acceso si el usuario deja de ser elegible y solo uno gana una atención concurrente', async () => {
    const doctor = await crearUsuario('doctor');
    const otroDoctor = await crearUsuario('doctor');
    const conversacion = await crearConversacion();
    const { alerta } = await crearAlerta('emergencia', 'wa018:concurrencia:1', conversacion);

    await db('usuarios').where({ id: doctor.id }).update({ notificaciones_alertas: false });
    await expect(service.atender(alerta.id, doctor.id)).rejects.toMatchObject({ status: 403 });
    await db('usuarios').where({ id: doctor.id }).update({ notificaciones_alertas: true });

    const resultados = await Promise.allSettled([
      service.atender(alerta.id, doctor.id),
      service.atender(alerta.id, otroDoctor.id),
    ]);
    expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((resultado) => resultado.status === 'rejected')).toHaveLength(1);
    expect(resultados.find((resultado) => resultado.status === 'rejected').reason.status).toBe(409);
    const atendida = await db('alertas_atencion_whatsapp').where({ id: alerta.id }).first();
    expect([doctor.id, otroDoctor.id]).toContain(atendida.atendida_por);
    expect(atendida.atendida_en).not.toBeNull();
  });

  it.each(['emergencia', 'recepcion'])(
    'un admin de respaldo puede atender una alerta de %s',
    async (tipo) => {
      const admin = await crearUsuario('admin');
      const conversacion = await crearConversacion();
      const { alerta } = await crearAlerta(tipo, `wa018:admin:${tipo}`, conversacion);

      await expect(service.atender(alerta.id, admin.id)).resolves.toMatchObject({
        estado: 'atendida',
        atendida_por: admin.id,
      });
    },
  );
});
