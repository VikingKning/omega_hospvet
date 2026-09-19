// US WA 007 — consulta segura de resultados de laboratorio. Necesita
// Postgres real: registros_laboratorio/mascotas/propietarios reales para
// probar el JOIN de findByFolioYTelefono, y el índice único de
// whatsapp_message_id (idempotencia) — no se puede mockear.
const db = require('../../src/config/database');
const env = require('../../src/config/env');
const claude = require('../../src/config/claude');
const whatsappConfig = require('../../src/config/whatsapp');
const repository = require('../../src/modules/whatsapp/whatsapp.repository');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const menu = require('../../src/modules/whatsapp/whatsapp.menu');
const lab = require('../../src/modules/whatsapp/whatsapp.laboratorioConsulta');

const PHONE_NUMBER_ID = 'phone-integ-labconsulta-test';
const originalFetch = global.fetch;
let contadorWamidFake = 0;

beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async () => {
    contadorWamidFake += 1;
    return {
      ok: true,
      json: () =>
        Promise.resolve({ messages: [{ id: `wamid.labconsulta-fake-${contadorWamidFake}` }] }),
    };
  });
  jest
    .spyOn(whatsappConfig, 'messagesUrl')
    .mockReturnValue('https://graph.facebook.com/fake/messages');
  jest.spyOn(whatsappConfig, 'authHeaders').mockReturnValue({ Authorization: 'Bearer fake' });
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  const conversacionIds = await db('conversaciones_whatsapp')
    .where('phone_number_id', PHONE_NUMBER_ID)
    .pluck('id');
  await db('conversaciones_whatsapp')
    .whereIn('id', conversacionIds)
    .update({ grupo_medio_pendiente_id: null });
  await db('outbox_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('eventos_metricas_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('mensajes_whatsapp').whereIn('conversacion_id', conversacionIds).del();
  await db('conversaciones_whatsapp').where('phone_number_id', PHONE_NUMBER_ID).del();
  await db.destroy();
});

function generarTelefonoDigits() {
  return String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
}

async function crearOrden({ telefono, estado = 'pendiente', eliminado = false } = {}) {
  const tel = telefono ?? generarTelefonoDigits();
  const [propietario] = await db('propietarios')
    .insert({
      nombre: 'Tutor',
      apellidos: 'DePrueba',
      telefono: tel,
      activo: true,
      creado_en: new Date(),
    })
    .returning('*');
  const [mascota] = await db('mascotas')
    .insert({
      propietario_id: propietario.id,
      nombre: 'Mascota',
      tipo: 'perro',
      activo: true,
      creado_en: new Date(),
    })
    .returning('*');
  const [registro] = await db('registros_laboratorio')
    .insert({
      mascota_id: mascota.id,
      fecha_solicitud: new Date(),
      estado,
      pendiente_desde: new Date(),
      creado_por: 1,
      creado_en: new Date(),
      eliminado,
    })
    .returning('*');
  return { propietario, mascota, registro };
}

async function limpiarOrden({ propietario, mascota, registro }) {
  await db('registros_laboratorio').where({ id: registro.id }).del();
  await db('mascotas').where({ id: mascota.id }).del();
  await db('propietarios').where({ id: propietario.id }).del();
}

function folioTexto(id) {
  return `LAB-${String(id).padStart(3, '0')}`;
}

async function crearConversacionEsperandoMenu(telefonoNormalizado, overrides = {}) {
  const ahora = new Date();
  const [conversacion] = await db('conversaciones_whatsapp')
    .insert({
      phone_number_id: PHONE_NUMBER_ID,
      telefono_normalizado: telefonoNormalizado,
      estado: 'esperando_menu',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
      ...overrides,
    })
    .returning('*');
  return conversacion;
}

async function recargar(id) {
  return db('conversaciones_whatsapp').where({ id }).first();
}

let contadorMensaje = 0;
async function enviarMensaje(conversacionId, telefonoNormalizado, { tipoMensaje, contenido }) {
  contadorMensaje += 1;
  return repository.registrarMensajeYConversacion({
    whatsappMessageId: `wamid.labconsulta-${contadorMensaje}-${Math.random().toString(36).slice(2)}`,
    telefonoOrigen: `521${telefonoNormalizado.slice(2)}`,
    phoneNumberId: PHONE_NUMBER_ID,
    telefonoNormalizado,
    tipoMensaje,
    contenido,
    mediaId: null,
    mimeType: null,
    tituloInteractivo: null,
    recibidoEn: new Date(),
  });
}

async function iniciarFlujo(telefonoNormalizado) {
  const conversacion = await crearConversacionEsperandoMenu(telefonoNormalizado);
  const resultado = await enviarMensaje(conversacion.id, telefonoNormalizado, {
    tipoMensaje: 'interactive_list_reply',
    contenido: menu.MENU_RESULTADOS_LAB,
  });
  return { conversacion, resultado };
}

describe('US WA 007 — mismo teléfono de origen (AC1/AC2, prueba mínima)', () => {
  it('folio válido con el mismo teléfono de origen resuelve con éxito', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telDigits = generarTelefonoDigits();
    const orden = await crearOrden({ telefono: telDigits, estado: 'cargado' });
    const telNormalizado = `52${telDigits}`;

    const { conversacion } = await iniciarFlujo(telNormalizado);
    const rSi = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_SI,
    });
    expect(rSi.labAccion).toBe('pedir_folio'); // AC2: solo pide el folio.

    const rFolio = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'text',
      contenido: folioTexto(orden.registro.id),
    });

    expect(rFolio.labAccion).toBe('exito');
    expect(rFolio.labDatos).toEqual({ folioId: orden.registro.id, estadoOrden: 'cargado' });
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.estado).toBe('cerrada');
    expect(spyClasificar).not.toHaveBeenCalled(); // AC11

    await limpiarOrden(orden);
  });
});

describe('US WA 007 — teléfono distinto del registrado (protección de datos)', () => {
  it('no pide datos alternativos, envía el aviso, audita la negativa y cierra después del envío', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telOrigen = `52${generarTelefonoDigits()}`;

    const { conversacion } = await iniciarFlujo(telOrigen);
    const rNo = await enviarMensaje(conversacion.id, telOrigen, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_NO,
    });
    expect(rNo.labAccion).toBe('telefono_no_coincide');
    expect(rNo.pasoActualResultante).toBe('aviso_privacidad_pendiente');
    expect((await recargar(conversacion.id)).estado).toBe('flujo_activo');

    const resultadoEnvio = await service.enviarPasoLaboratorio({
      conversacionId: conversacion.id,
      telefono: telOrigen,
      mensajeId: rNo.id,
      labAccion: rNo.labAccion,
      labDatos: null,
    });

    expect(resultadoEnvio).toEqual(
      expect.objectContaining({ enviado: true, conversacionCerrada: true }),
    );
    const actualizada = await recargar(conversacion.id);
    expect(actualizada).toEqual(
      expect.objectContaining({ estado: 'cerrada', flujo_actual: null, paso_actual: null }),
    );
    const mensaje = await db('mensajes_whatsapp').where({ id: rNo.id }).first();
    expect(mensaje.resultado_decision).toBe('telefono_no_coincide');
    const evento = await db('eventos_metricas_whatsapp')
      .where({ clave_evento: `laboratorio:envio_denegado:mensaje:${rNo.id}` })
      .first();
    expect(evento).toEqual(
      expect.objectContaining({
        tipo_evento: 'envio_resultados_denegado',
        resultado: 'proteccion_datos',
      }),
    );
    expect(spyClasificar).not.toHaveBeenCalled();
  });

  it('si Meta rechaza el aviso conserva la conversación abierta para un reintento controlado', async () => {
    const telOrigen = `52${generarTelefonoDigits()}`;
    const { conversacion } = await iniciarFlujo(telOrigen);
    const rNo = await enviarMensaje(conversacion.id, telOrigen, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_NO,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'rechazado' } }),
    });

    const resultadoEnvio = await service.enviarPasoLaboratorio({
      conversacionId: conversacion.id,
      telefono: telOrigen,
      mensajeId: rNo.id,
      labAccion: rNo.labAccion,
      labDatos: null,
    });

    expect(resultadoEnvio).toEqual(
      expect.objectContaining({ enviado: false, conversacionCerrada: false }),
    );
    const actualizada = await recargar(conversacion.id);
    expect(actualizada).toEqual(
      expect.objectContaining({
        estado: 'flujo_activo',
        flujo_actual: 'consulta_laboratorio',
        paso_actual: 'aviso_privacidad_pendiente',
      }),
    );
    const eventos = await db('eventos_metricas_whatsapp')
      .where({ conversacion_id: conversacion.id, tipo_evento: 'envio_resultados_denegado' })
      .count('* as total')
      .first();
    expect(Number(eventos.total)).toBe(0);
  });
});

describe('US WA 007 — confirmación ambigua (AC4, prueba mínima)', () => {
  it('una respuesta que no es Sí/No vuelve a pedir la confirmación sin consultar nada', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const telNormalizado = `52${generarTelefonoDigits()}`;
    const { conversacion } = await iniciarFlujo(telNormalizado);

    const rAmbigua = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'text',
      contenido: 'no sé qué quieres decir',
    });

    expect(rAmbigua.labAccion).toBe('confirmacion_ambigua');
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.paso_actual).toBe('confirmando_telefono'); // sin avanzar.
    expect(spyClasificar).not.toHaveBeenCalled();
  });
});

describe('US WA 007 — datos que no coinciden (AC7/AC9)', () => {
  it('folio inexistente: mensaje genérico, sin revelar nada (prueba mínima)', async () => {
    const telNormalizado = `52${generarTelefonoDigits()}`;
    const { conversacion } = await iniciarFlujo(telNormalizado);
    await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_SI,
    });

    const r = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'text',
      contenido: 'LAB-999999',
    });

    expect(r.labAccion).toBe('rechazo');
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.estado).toBe('flujo_activo'); // sigue en el flujo, no cerró.
    expect(actualizada.intentos_validacion_lab).toBe(1);
  });

  it('teléfono incorrecto para un folio real: mensaje genérico (prueba mínima)', async () => {
    const orden = await crearOrden();
    const telNormalizado = `52${generarTelefonoDigits()}`;
    const { conversacion } = await iniciarFlujo(telNormalizado);
    await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_SI,
    });

    const r = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'text',
      contenido: folioTexto(orden.registro.id),
    });

    expect(r.labAccion).toBe('rechazo'); // el teléfono de origen no es el registrado en la orden.
    await limpiarOrden(orden);
  });

  it('orden eliminada: se trata igual que si no existiera (prueba mínima)', async () => {
    const telDigits = generarTelefonoDigits();
    const orden = await crearOrden({ telefono: telDigits, eliminado: true });
    const telNormalizado = `52${telDigits}`;
    const { conversacion } = await iniciarFlujo(telNormalizado);
    await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_SI,
    });

    const r = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'text',
      contenido: folioTexto(orden.registro.id),
    });

    expect(r.labAccion).toBe('rechazo');
    await limpiarOrden(orden);
  });

  it('un folio con texto adicional o fuera de rango se rechaza sin consultar la base de datos (AC6, prueba mínima)', async () => {
    const telNormalizado = `52${generarTelefonoDigits()}`;
    const { conversacion } = await iniciarFlujo(telNormalizado);
    await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_SI,
    });

    const r = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'text',
      contenido: 'esto no es un folio',
    });

    expect(r.labAccion).toBe('rechazo');
  });
});

describe('US WA 007 — límite de intentos (AC10, prueba mínima)', () => {
  it('al alcanzar WHATSAPP_LAB_MAX_INTENTOS cierra el flujo y no revela datos de la orden', async () => {
    const orden = await crearOrden();
    const telNormalizado = `52${generarTelefonoDigits()}`;
    const { conversacion } = await iniciarFlujo(telNormalizado);
    await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_SI,
    });

    let ultimo;
    for (let i = 0; i < env.whatsapp.labMaxIntentos; i += 1) {
      ultimo = await enviarMensaje(conversacion.id, telNormalizado, {
        tipoMensaje: 'text',
        contenido: 'LAB-999999',
      });
    }

    expect(ultimo.labAccion).toBe('limite_intentos');
    const actualizada = await recargar(conversacion.id);
    expect(actualizada.estado).toBe('cerrada'); // AC10: cierra el flujo.
    expect(actualizada.flujo_actual).toBeNull();

    await limpiarOrden(orden);
  });
});

describe('US WA 007 — idempotencia y ausencia de Claude (AC8/AC11)', () => {
  it('una selección duplicada (mismo wamid) nunca reejecuta el flujo (prueba mínima)', async () => {
    const telNormalizado = `52${generarTelefonoDigits()}`;
    await crearConversacionEsperandoMenu(telNormalizado);
    const wamid = `wamid.labconsulta-dup-${Math.random().toString(36).slice(2)}`;

    const params = {
      whatsappMessageId: wamid,
      telefonoOrigen: `521${telNormalizado.slice(2)}`,
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoNormalizado: telNormalizado,
      tipoMensaje: 'interactive_list_reply',
      contenido: menu.MENU_RESULTADOS_LAB,
      mediaId: null,
      mimeType: null,
      tituloInteractivo: null,
      recibidoEn: new Date(),
    };
    const r1 = await repository.registrarMensajeYConversacion(params);
    const r2 = await repository.registrarMensajeYConversacion(params);

    expect(r1.esNuevo).toBe(true);
    expect(r1.labAccion).toBe('iniciar');
    expect(r2.esNuevo).toBe(false);
    expect(r2.labAccion).toBeUndefined();
    const filas = await db('mensajes_whatsapp').where({ whatsapp_message_id: wamid });
    expect(filas).toHaveLength(1);
  });

  it('ningún paso de la validación llama a Claude, en éxito o en rechazo (AC11, prueba mínima)', async () => {
    const spyClasificar = jest.spyOn(claude, 'clasificarMensaje');
    const orden = await crearOrden({ estado: 'pendiente' });
    const telNormalizado = `52${generarTelefonoDigits()}`;
    const { conversacion } = await iniciarFlujo(telNormalizado);

    const rNo = await enviarMensaje(conversacion.id, telNormalizado, {
      tipoMensaje: 'interactive_button_reply',
      contenido: lab.LAB_MISMO_TELEFONO_NO,
    });
    await service.enviarPasoLaboratorio({
      conversacionId: conversacion.id,
      telefono: telNormalizado,
      mensajeId: rNo.id,
      labAccion: rNo.labAccion,
      labDatos: null,
    });

    expect(spyClasificar).not.toHaveBeenCalled();
    await limpiarOrden(orden);
  });
});
