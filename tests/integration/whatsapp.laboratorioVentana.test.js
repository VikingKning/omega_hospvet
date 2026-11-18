const db = require('../../src/config/database');
const env = require('../../src/config/env');
const whatsapp = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');
const { enviarResultadoLaboratorio } = require('../../src/modules/whatsapp/whatsapp.envios');

const PHONE_ID = 'phone-lab-ventana-test';
const TELEFONO = '525500779999';
const originalPhoneId = env.whatsapp.phoneNumberId;
const originalFetch = global.fetch;
let secuencia = 0;
let conversaciones = [];

async function crearConversacion(cambios = {}) {
  const [fila] = await db('conversaciones_whatsapp')
    .insert({
      phone_number_id: PHONE_ID,
      telefono_normalizado: TELEFONO,
      estado: 'cerrada',
      primer_fragmento_en: db.raw("now() - interval '25 hours'"),
      ultima_interaccion_en: db.fn.now(),
      cerrado_en: db.fn.now(),
      ...cambios,
    })
    .returning('*');
  conversaciones.push(fila.id);
  return fila;
}

async function mensaje(conversacionId, cambios = {}) {
  secuencia += 1;
  const [fila] = await db('mensajes_whatsapp')
    .insert({
      conversacion_id: conversacionId,
      whatsapp_message_id: `wamid.lab-ventana-test-${secuencia}`,
      telefono_origen: TELEFONO,
      tipo_mensaje: 'text',
      mensaje_recibido: 'Consultar resultados',
      categoria_clasificacion: null,
      direccion: 'entrante',
      tokens_entrada: 0,
      tokens_salida: 0,
      recibido_en: db.raw("now() - interval '1 hour'"),
      estado_procesamiento: 'procesado',
      ...cambios,
    })
    .returning('*');
  return fila;
}

beforeAll(() => {
  env.whatsapp.phoneNumberId = PHONE_ID;
});
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [{ id: `wamid.lab-ventana-saliente-${++secuencia}` }] }),
  });
  jest.spyOn(whatsapp, 'messagesUrl').mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsapp, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
});
afterEach(async () => {
  await db('envios_whatsapp').where('destinatario_telefono', TELEFONO).del();
  await db('outbox_whatsapp').where('clave_idempotencia', 'like', 'test:lab-ventana:%').del();
  await db('mensajes_whatsapp').whereIn('conversacion_id', conversaciones).del();
  await db('conversaciones_whatsapp').whereIn('id', conversaciones).del();
  conversaciones = [];
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});
afterAll(async () => {
  env.whatsapp.phoneNumberId = originalPhoneId;
  await db.destroy();
});

it('permite documento directo por un mensaje entrante real aun con conversación cerrada y conserva idempotencia', async () => {
  const conversacion = await crearConversacion();
  await mensaje(conversacion.id);
  const datos = {
    telefono: TELEFONO,
    nombreMascota: 'Firulais',
    folio: '005',
    mediaId: 'media-lab',
    nombreArchivo: 'Resultado_Omega_01.pdf',
    claveIdempotencia: 'test:lab-ventana:documento',
  };
  await enviarResultadoLaboratorio(datos);
  await enviarResultadoLaboratorio(datos);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).type).toBe('document');
  const intent = await repository.buscarIntentoPorClave(datos.claveIdempotencia);
  expect(intent).toMatchObject({
    estado: 'enviado',
    usa_plantilla: false,
    conversacion_id: conversacion.id,
  });
});

it.each([
  ['saliente', { direccion: 'saliente' }],
  [
    'continuación sintética',
    { whatsapp_message_id: 'wamid.lab-ventana-test:lfpdppp_continuacion' },
  ],
  ['vencido', { recibido_en: db.raw("now() - interval '24 hours' - interval '1 second'") }],
  ['futuro', { recibido_en: db.raw("now() + interval '1 hour'") }],
])(
  'no toma %s como apertura de ventana aunque ultima_interaccion_en sea reciente',
  async (_nombre, cambios) => {
    const conversacion = await crearConversacion();
    await mensaje(conversacion.id, cambios);
    expect(await repository.buscarVentanaServicioCliente(TELEFONO)).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

it('aísla la ventana por tutor y por número oficial de la clínica', async () => {
  const otraCuenta = await crearConversacion({ phone_number_id: 'phone-lab-otro-test' });
  await mensaje(otraCuenta.id);
  const otroTutor = await crearConversacion({ telefono_normalizado: '525500779998' });
  await mensaje(otroTutor.id, { telefono_origen: '525500779998' });
  expect(await repository.buscarVentanaServicioCliente(TELEFONO)).toBeUndefined();
});

it.each(['document', 'image'])(
  'revalida la ventana de %s después de registrar el intento y bloquea Meta si venció',
  async (tipo) => {
    const conversacion = await crearConversacion();
    const entrante = await mensaje(conversacion.id);
    const { intent } = await outbox.registrarIntento({
      claveIdempotencia: `test:lab-ventana:vencida:${tipo}`,
      tipoEnvio: 'conversacional',
      origenFuncional: 'laboratorio',
      conversacionId: conversacion.id,
      destinatarioTelefono: TELEFONO,
      payloadFuncional: {
        tipo,
        finalidad: 'resultados_laboratorio',
        destinatarioTelefono: TELEFONO,
        [tipo]: { id: 'media-lab' },
      },
      usaPlantilla: false,
    });
    await db('mensajes_whatsapp')
      .where({ id: entrante.id })
      .update({ recibido_en: db.raw("now() - interval '25 hours'") });
    expect(await outbox.ejecutarIntento(intent.clave_idempotencia)).toEqual({
      enviado: false,
      motivo: 'ventana_servicio_expirada',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect((await repository.buscarIntentoPorClave(intent.clave_idempotencia)).estado).toBe(
      'ventana_servicio_expirada',
    );
  },
);
