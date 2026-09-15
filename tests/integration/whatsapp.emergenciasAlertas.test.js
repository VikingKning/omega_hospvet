const db = require('../../src/config/database');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const plantillasRepository = require('../../src/modules/plantillas_whatsapp/plantillas_whatsapp.repository');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const emergenciasAlertasService = require('../../src/modules/whatsapp/whatsapp.emergenciasAlertas.service');

const PHONE_NUMBER_ID = 'phone-integ-wa016';
const TELEFONO = '525500016001';
const originalFetch = global.fetch;

async function limpiar() {
  const conversaciones = await db('conversaciones_whatsapp')
    .where({ phone_number_id: PHONE_NUMBER_ID })
    .pluck('id');
  if (!conversaciones.length) return;
  const grupos = await db('grupos_whatsapp')
    .whereIn('conversacion_id', conversaciones)
    .pluck('group_id');
  const alertas = await db('alertas_atencion_whatsapp')
    .whereIn('conversacion_id', conversaciones)
    .pluck('id');
  await db('intentos_alerta_whatsapp').whereIn('alerta_id', alertas).del();
  await db('destinatarios_alerta_whatsapp').whereIn('alerta_id', alertas).del();
  await db('alertas_atencion_whatsapp').whereIn('id', alertas).del();
  await db('solicitudes_atencion_humana').whereIn('conversacion_id', conversaciones).del();
  await db('grupos_whatsapp').whereIn('group_id', grupos).update({ intento_envio_id: null });
  await db('emergencias_confirmadas').whereIn('group_id', grupos).del();
  await db('outbox_whatsapp').whereIn('conversacion_id', conversaciones).del();
  await db('mensajes_whatsapp').whereIn('conversacion_id', conversaciones).del();
  await db('grupos_whatsapp').whereIn('group_id', grupos).del();
  await db('conversaciones_whatsapp').whereIn('id', conversaciones).del();
}

beforeAll(limpiar);

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await limpiar();
  await db.destroy();
});

describe('US WA 016 — emergencia confirmada a solicitud WA018', () => {
  it('persiste la alerta crítica antes del envío y un reintento no reclasifica ni duplica', async () => {
    const plantilla = await db('plantillas_whatsapp')
      .where({ slug: 'emergencia-medica', activo: true, es_emergencia: true })
      .first();
    expect(plantilla).toBeDefined();

    const ahora = new Date();
    const [conversacion] = await db('conversaciones_whatsapp')
      .insert({
        phone_number_id: PHONE_NUMBER_ID,
        telefono_normalizado: TELEFONO,
        estado: 'procesando',
        primer_fragmento_en: ahora,
        ultima_interaccion_en: ahora,
      })
      .returning('*');
    const [grupo] = await db('grupos_whatsapp')
      .insert({
        conversacion_id: conversacion.id,
        texto_consolidado: 'mi mascota no puede respirar',
        estado: 'pendiente_enrutamiento',
      })
      .returning('*');

    const spyClaude = jest
      .spyOn(claude, 'clasificarMensaje')
      .mockResolvedValue({ etiqueta: plantilla.slug, tokensEntrada: 17, tokensSalida: 4 });
    const spyPlantilla = jest.spyOn(plantillasRepository, 'findBySlug');
    jest.spyOn(whatsappConfig, 'messagesUrl').mockReturnValue('https://graph.test/messages');
    jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer test' });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'Meta temporalmente no disponible' } }),
    });

    await expect(
      service.clasificarYResponderGrupo({
        conversacionId: conversacion.id,
        groupId: grupo.group_id,
        textoConsolidado: grupo.texto_consolidado,
        telefono: TELEFONO,
      }),
    ).resolves.toBe('emergencia_fallo_envio');

    const confirmada = await db('emergencias_confirmadas')
      .where({ group_id: grupo.group_id })
      .first();
    const alerta = await db('alertas_atencion_whatsapp')
      .where({ grupo_id: grupo.group_id })
      .first();
    expect(confirmada.es_emergencia).toBe(true);
    expect(alerta).toMatchObject({
      clave_idempotencia: `emergencia:${grupo.group_id}`,
      tipo_alerta: 'emergencia',
      conversacion_id: conversacion.id,
      grupo_id: grupo.group_id,
      telefono_externo: TELEFONO,
      origen: 'emergencia_whatsapp',
      prioridad: 'critica',
      estado: 'pendiente',
      resolucion_destinatarios: 'pendiente',
      tokens_entrada: 0,
      tokens_salida: 0,
    });
    expect(alerta.creado_en.getTime()).toBe(confirmada.confirmado_en.getTime());

    await Promise.all([
      emergenciasAlertasService.registrarDesdeEmergenciaConfirmada({
        emergenciaConfirmada: confirmada,
        telefonoExterno: TELEFONO,
      }),
      emergenciasAlertasService.registrarDesdeEmergenciaConfirmada({
        emergenciaConfirmada: confirmada,
        telefonoExterno: TELEFONO,
      }),
    ]);
    await expect(
      db('alertas_atencion_whatsapp').where({ grupo_id: grupo.group_id }),
    ).resolves.toHaveLength(1);

    await expect(
      db('destinatarios_alerta_whatsapp').where({ alerta_id: alerta.id }),
    ).resolves.toHaveLength(0);
    await expect(
      db('intentos_alerta_whatsapp').where({ alerta_id: alerta.id }),
    ).resolves.toHaveLength(0);

    const grupoPersistido = await db('grupos_whatsapp').where({ group_id: grupo.group_id }).first();
    expect(grupoPersistido).toMatchObject({
      es_emergencia_resuelta: true,
      tokens_entrada: 17,
      tokens_salida: 4,
    });

    spyPlantilla.mockClear();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: 'wamid.wa016-reintento' }] }),
    });
    await expect(
      service.clasificarYResponderGrupo({
        conversacionId: conversacion.id,
        groupId: grupo.group_id,
        textoConsolidado: grupo.texto_consolidado,
        telefono: TELEFONO,
      }),
    ).resolves.toBe('clasificado_emergencia');

    expect(spyClaude).toHaveBeenCalledTimes(1);
    expect(spyPlantilla).not.toHaveBeenCalled();
    await expect(
      db('alertas_atencion_whatsapp').where({ grupo_id: grupo.group_id }),
    ).resolves.toHaveLength(1);
  });
});
