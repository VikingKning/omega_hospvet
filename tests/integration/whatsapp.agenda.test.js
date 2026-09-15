// US WA 006 — integración real entre rutas deterministas, outbox WA015,
// cierre de conversación y transferencia WA017/WA010. Solo se simula la
// respuesta HTTP de Meta; la persistencia y las transiciones usan Postgres.
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const atencionHumanaService = require('../../src/modules/whatsapp/whatsapp.atencionHumana.service');

const PHONE_NUMBER_ID = 'phone-integ-agenda-test';
const CLAVE_PREFIX = 'mensaje:agenda-integ-';
const consultaOriginal = env.enlaces.calendarioCitas;
const esteticaOriginal = env.enlaces.calendarioEstetica;
const originalFetch = global.fetch;
let contadorTelefono = 0;
let contadorWamid = 0;

beforeEach(() => {
  env.enlaces.calendarioCitas = 'https://calendar.example/consulta';
  env.enlaces.calendarioEstetica = 'https://calendar.example/estetica';
  global.fetch = jest.fn().mockImplementation(async () => {
    contadorWamid += 1;
    return {
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: `wamid.agenda-${contadorWamid}` }] }),
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
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  if (conversacionIds.length) {
    await db('solicitudes_atencion_humana').whereIn('conversacion_id', conversacionIds).del();
  }
});

afterAll(async () => {
  env.enlaces.calendarioCitas = consultaOriginal;
  env.enlaces.calendarioEstetica = esteticaOriginal;
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
  await db('solicitudes_atencion_humana').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('outbox_whatsapp').whereIn('intent_id', outboxAlertasIds).del();
  await db('conversaciones_whatsapp').where('phone_number_id', PHONE_NUMBER_ID).del();
  await db.destroy();
});

function generarTelefono() {
  contadorTelefono += 1;
  return `52550009${String(contadorTelefono).padStart(4, '0')}`;
}

async function crearConversacion() {
  const telefono = generarTelefono();
  const ahora = new Date();
  const [conversacion] = await db('conversaciones_whatsapp')
    .insert({
      phone_number_id: PHONE_NUMBER_ID,
      telefono_normalizado: telefono,
      estado: 'esperando_menu',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
    })
    .returning('*');
  return { conversacion, telefono };
}

describe('US WA 006 — enlaces de Consulta y Estética', () => {
  it.each([
    ['agendar_consulta', 'Consulta', 'https://calendar.example/consulta'],
    ['agendar_estetica', 'Estética', 'https://calendar.example/estetica'],
  ])('envía %s sin Claude y cierra después de que Meta acepta', async (ruta, tipo, url) => {
    const { conversacion, telefono } = await crearConversacion();
    const spyClaude = jest.spyOn(claude, 'clasificarMensaje');
    const claveBase = `${CLAVE_PREFIX}${contadorTelefono}`;

    const resultado = await service.enviarEnlaceAgenda({
      conversacionId: conversacion.id,
      telefono,
      claveBase,
      ruta,
    });

    expect(resultado).toMatchObject({ enviado: true, conversacionCerrada: true });
    expect(spyClaude).not.toHaveBeenCalled();
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.text.body).toContain(`cita de ${tipo}`);
    expect(body.text.body).toContain(url);
    const intentos = await db('outbox_whatsapp').where({
      clave_idempotencia: `${claveBase}:${ruta}:enlace`,
    });
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toMatchObject({ estado: 'enviado', conversacion_id: conversacion.id });
    await expect(
      db('conversaciones_whatsapp').where({ id: conversacion.id }).first(),
    ).resolves.toMatchObject({ estado: 'cerrada' });
  });

  it('un rechazo conserva un solo intento y deja abierta la conversación para un reintento controlado', async () => {
    const { conversacion, telefono } = await crearConversacion();
    const claveBase = `${CLAVE_PREFIX}reintento-${contadorTelefono}`;
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { code: 131000, message: 'rechazado' } }),
    });

    const fallido = await service.enviarEnlaceAgenda({
      conversacionId: conversacion.id,
      telefono,
      claveBase,
      ruta: 'agendar_consulta',
    });

    expect(fallido).toMatchObject({ enviado: false, conversacionCerrada: false });
    await expect(
      db('conversaciones_whatsapp').where({ id: conversacion.id }).first(),
    ).resolves.toMatchObject({ estado: 'esperando_menu' });
    await expect(
      db('outbox_whatsapp')
        .where({ clave_idempotencia: `${claveBase}:agendar_consulta:enlace` })
        .first(),
    ).resolves.toMatchObject({ estado: 'fallido', intentos: 1 });

    const reintento = await service.enviarEnlaceAgenda({
      conversacionId: conversacion.id,
      telefono,
      claveBase,
      ruta: 'agendar_consulta',
    });

    expect(reintento).toMatchObject({ enviado: true, conversacionCerrada: true });
    const intentos = await db('outbox_whatsapp').where({
      clave_idempotencia: `${claveBase}:agendar_consulta:enlace`,
    });
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toMatchObject({ estado: 'enviado', intentos: 2 });
  });

  it.each([
    ['agendar_consulta', undefined, 'Consulta'],
    ['agendar_estetica', 'http://calendar.example/estetica', 'Estética'],
  ])(
    'sin HTTPS válido en %s avisa y solo entonces transfiere a Recepción',
    async (ruta, valor, tipo) => {
      const { conversacion, telefono } = await crearConversacion();
      if (ruta === 'agendar_consulta') env.enlaces.calendarioCitas = valor;
      else env.enlaces.calendarioEstetica = valor;
      const claveBase = `${CLAVE_PREFIX}recepcion-${contadorTelefono}`;

      const preparado = await service.enviarEnlaceAgenda({
        conversacionId: conversacion.id,
        telefono,
        claveBase,
        ruta,
      });

      expect(preparado).toEqual({ enviado: false, transferidaARecepcion: true });
      expect(global.fetch).not.toHaveBeenCalled();
      await expect(
        db('conversaciones_whatsapp').where({ id: conversacion.id }).first(),
      ).resolves.toMatchObject({ estado: 'esperando_menu' });

      const procesada = await atencionHumanaService.procesarSiguienteSolicitudPendiente();

      expect(procesada.resultado).toBe('enviada');
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.text.body).toContain(tipo);
      expect(body.text.body).toContain('Recepción continuará con tu atención');
      expect(body.text.body).not.toContain('http://');
      await expect(
        db('conversaciones_whatsapp').where({ id: conversacion.id }).first(),
      ).resolves.toMatchObject({ estado: 'atencion_humana' });
    },
  );
});
