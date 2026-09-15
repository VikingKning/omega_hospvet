// US WA 017: capa de datos del mecanismo único de atención humana —
// solicitudes_atencion_humana (la transferencia en sí) + las consultas de
// conversaciones_whatsapp específicas de este ciclo (activar, vencer,
// reactivar). Vive separado de whatsapp.repository.js por el mismo
// criterio que whatsapp.laboratorioConsulta.js: un concern propio con
// varias funciones relacionadas, no una sola regla más de
// aplicarReglasDeInteraccion — aunque SÍ se llama DESDE
// whatsapp.repository.js#registrarMensajeYConversacion para el caso
// "mensaje entrante mientras la conversación ya está en atencion_humana",
// dentro de la MISMA transacción (mismo criterio que
// laboratorioConsulta.procesarPaso).
const db = require('../../config/database');
const env = require('../../config/env');
const { TRANSICIONES, validarTransicion } = require('./whatsapp.estados');

// US WA 003: misma ventana de agrupación normal (AC17) — se reutiliza tal
// cual para la conversación nueva que nace tras un vencimiento de atención
// humana (AC16/17), en vez de duplicar el valor.
const DEBOUNCE_ACUMULANDO_MS = env.whatsapp.agrupacionSegundos * 1000;

// ---------------------------------------------------------------------
// solicitudes_atencion_humana (AC1-AC24)
// ---------------------------------------------------------------------

// AC1/AC2: INSERT ... ON CONFLICT DO NOTHING sobre clave_idempotencia —
// mismo idioma que crearMensajePendiente/registrarIntentoEnvio (US WA
// 001/015). Un reintento del mismo origen con la MISMA clave reutiliza la
// fila existente en vez de crear "otro mensaje de transferencia" (AC2).
// `trx` opcional (US WA 009 AC23): permite que un llamador (la
// clasificación de un grupo de emergencia) componga este INSERT dentro de
// su propia transacción atómica — omitido, se comporta exactamente igual
// que antes de esa historia (una escritura suelta contra `db`).
async function solicitarAtencionHumana({
  conversacionId,
  origen,
  prioridad,
  claveIdempotencia,
  referenciasFuncionales,
  envioPrevioId,
  ahora,
  trx,
}) {
  const conexion = trx ?? db;
  const [creada] = await conexion('solicitudes_atencion_humana')
    .insert({
      conversacion_id: conversacionId,
      origen,
      prioridad: prioridad ?? null,
      clave_idempotencia: claveIdempotencia,
      referencias_funcionales: referenciasFuncionales ?? null,
      envio_previo_id: envioPrevioId ?? null,
      solicitado_en: ahora,
    })
    .onConflict('clave_idempotencia')
    .ignore()
    .returning('*');
  const solicitud =
    creada ??
    (await conexion('solicitudes_atencion_humana')
      .where({ clave_idempotencia: claveIdempotencia })
      .first());
  return { solicitud, esNueva: Boolean(creada) };
}

// AC19/AC22: mismo patrón FOR UPDATE SKIP LOCKED que
// reclamarConversacionVencida — 2 workers nunca reclaman la misma
// solicitud. Reclama tanto 'pendiente' (primer intento) como
// 'fallida_reintentable' (reintento tras un fallo de Meta, AC19) — nunca
// 'fallida_terminal' (agotada, no se reintenta). Junto con la solicitud
// trae los datos de la conversación que el envío necesita (telefono
// normalizado) para no obligar al llamador a una segunda consulta.
async function reclamarSolicitudPendiente() {
  return db.transaction(async (trx) => {
    const solicitud = await trx({ solicitud: 'solicitudes_atencion_humana' })
      .leftJoin({ previo: 'outbox_whatsapp' }, 'previo.intent_id', 'solicitud.envio_previo_id')
      .where((builder) => {
        builder
          .where('solicitud.estado', 'pendiente')
          .orWhere((fallida) => {
            fallida.where('solicitud.estado', 'fallida_reintentable').andWhere((lista) => {
              lista
                .whereNull('solicitud.reintentar_despues_de')
                .orWhere('solicitud.reintentar_despues_de', '<=', trx.fn.now());
            });
          })
          .orWhere((abandonada) => {
            abandonada
              .where('solicitud.estado', 'enviando')
              .andWhere(
                'solicitud.actualizado_en',
                '<=',
                trx.raw(
                  `now() - interval '${Number(env.whatsapp.workerReclamoHuerfanoSegundos)} seconds'`,
                ),
              );
          });
      })
      // Una solicitud con dependencia no lista no bloquea las siguientes.
      .andWhere((builder) => {
        builder.whereNull('solicitud.envio_previo_id').orWhere('previo.estado', 'enviado');
      })
      .orderByRaw("CASE WHEN solicitud.prioridad = 'critica' THEN 0 ELSE 1 END")
      .orderBy('solicitud.solicitado_en', 'asc')
      .limit(1)
      .forUpdate('solicitud')
      .skipLocked()
      .select('solicitud.*')
      .first();
    if (!solicitud) return null;

    const conversacion = await trx('conversaciones_whatsapp')
      .where({ id: solicitud.conversacion_id })
      .first('telefono_normalizado', 'estado');

    await trx('solicitudes_atencion_humana').where({ id: solicitud.id }).update({
      estado: 'enviando',
      reintentar_despues_de: null,
      actualizado_en: trx.fn.now(),
    });

    return { ...solicitud, telefonoNormalizado: conversacion?.telefono_normalizado ?? null };
  });
}

// `trx` opcional — mismo criterio que solicitarAtencionHumana de arriba.
async function marcarSolicitudOutbox(solicitudId, outboxId, trx) {
  const conexion = trx ?? db;
  await conexion('solicitudes_atencion_humana')
    .where({ id: solicitudId })
    .update({ outbox_id: outboxId, actualizado_en: conexion.fn.now() });
}

// AC19: un fallo del envío (Meta rechaza, o la propia llamada truena) deja
// la solicitud reintentable — el worker la vuelve a reclamar en el
// siguiente ciclo, con la MISMA clave de idempotencia de outbox_whatsapp
// (nunca duplica el mensaje si de verdad ya había llegado a Meta).
async function marcarSolicitudFallidaReintentable(solicitudId) {
  await db('solicitudes_atencion_humana')
    .where({ id: solicitudId })
    .update({
      estado: 'fallida_reintentable',
      reintentar_despues_de: db.raw(
        `now() + interval '${Number(env.whatsapp.atencionHumanaReintentoSegundos)} seconds'`,
      ),
      actualizado_en: db.fn.now(),
    });
}

// AC6/AC22: transacción + bloqueo de fila — el UPDATE de la solicitud Y la
// transición de la conversación a atencion_humana viven en la MISMA
// transacción, con SELECT ... FOR UPDATE sobre la conversación primero,
// para que 2 workers que confirmaran el mismo envío casi al mismo tiempo
// (imposible en la práctica, ya que reclamarSolicitudPendiente ya serializa
// por solicitud, pero AC22 lo exige explícito) nunca produzcan una
// transición doble. atencion_humana_hasta se calcula UNA sola vez aquí, a
// partir de `ahora` (la fecha efectiva del envío, AC6) — WHATSAPP_ATENCION_HUMANA_HORAS.
async function confirmarTransferenciaEnviada(solicitudId, { conversacionId, ahora }) {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .forUpdate()
      .first('estado');
    if (!conversacion || !validarTransicion(conversacion.estado, 'atencion_humana')) {
      return false;
    }

    await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .update({
        estado: 'atencion_humana',
        atencion_humana_desde: ahora,
        atencion_humana_hasta: trx.raw(
          `?::timestamptz + interval '${Number(env.whatsapp.atencionHumanaHoras)} hours'`,
          [ahora],
        ),
        origen_atencion_humana: 'solicitud_transferencia',
        flujo_actual: null,
        paso_actual: null,
        updated_at: ahora,
      });

    await cancelarEnviosConversacionalesPendientes(trx, conversacionId);

    await trx('solicitudes_atencion_humana').where({ id: solicitudId }).update({
      estado: 'finalizada',
      enviado_en: ahora,
      finalizado_en: ahora,
      actualizado_en: ahora,
    });

    return true;
  });
}

// AC15/AC22: mismo patrón FOR UPDATE SKIP LOCKED — el worker consulta
// conversaciones en atencion_humana cuyo vencimiento ya pasó según el
// reloj de PostgreSQL (consideración técnica: "NOW() como fuente de
// verdad"), nunca Date.now() de Node.
async function reclamarAtencionHumanaVencida() {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .where('estado', 'atencion_humana')
      .andWhere('atencion_humana_hasta', '<=', trx.fn.now())
      .orderBy('atencion_humana_hasta', 'asc')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .first();
    if (!conversacion) return null;

    await trx('conversaciones_whatsapp').where({ id: conversacion.id }).update({
      estado: 'cerrada',
      cerrado_en: trx.fn.now(),
      motivo_cierre: 'vencimiento_atencion_humana',
      updated_at: trx.fn.now(),
    });

    return conversacion.id;
  });
}

// AC36: al pasar a atencion_humana, cancela SOLO las respuestas
// conversacionales automáticas del bot que todavía no se hayan enviado —
// nunca resultados de laboratorio u otros envíos transaccionales
// independientes (tipo_envio/origen_funcional distintos). No toca nada ya
// 'enviado' (ya salió, cancelarlo no tendría efecto real) ni 'fallido'
// (ya terminó su ciclo).
async function cancelarEnviosConversacionalesPendientes(trx, conversacionId) {
  await trx('outbox_whatsapp')
    .where({
      conversacion_id: conversacionId,
      tipo_envio: 'conversacional',
      origen_funcional: 'respuesta_automatica',
      estado: 'pendiente',
    })
    .update({ estado: 'cancelado', actualizado_en: trx.fn.now() });
}

// ---------------------------------------------------------------------
// Mensajes entrantes DURANTE atencion_humana (AC7-AC14/AC16-AC18/AC20)
// ---------------------------------------------------------------------

// AC8/AC9: idéntico idioma de idempotencia que crearMensajePendiente (US
// WA 001) — ON CONFLICT DO NOTHING sobre whatsapp_message_id — pero
// SOLAMENTE metadatos: nunca mensaje_recibido/media_id/mime_type. Se
// asocia a `conversacionId` en el MISMO INSERT (a diferencia del flujo
// normal, que lo hace en un UPDATE posterior) porque aquí ya se conoce
// desde el principio — nunca se forma un grupo con estos mensajes (AC9,
// group_id se queda NULL para siempre).
async function crearMensajeIgnorado(
  trx,
  {
    whatsappMessageId,
    telefonoOrigen,
    tipoMensaje,
    conversacionId,
    recibidoEn,
    estadoProcesamiento,
  },
) {
  const [row] = await trx('mensajes_whatsapp')
    .insert({
      whatsapp_message_id: whatsappMessageId,
      telefono_origen: telefonoOrigen,
      tipo_mensaje: tipoMensaje,
      conversacion_id: conversacionId,
      direccion: 'entrante',
      estado_procesamiento: estadoProcesamiento,
      mensaje_recibido: null,
      media_id: null,
      mime_type: null,
      categoria_clasificacion: null,
      tokens_entrada: 0,
      tokens_salida: 0,
      recibido_en: recibidoEn,
      procesado_en: recibidoEn,
    })
    .onConflict('whatsapp_message_id')
    .ignore()
    .returning('id');
  return row ? { id: row.id, esNuevo: true } : { id: null, esNuevo: false };
}

const ESTADOS_QUE_PERMITEN_ATENCION_HUMANA = Object.keys(TRANSICIONES).filter((estado) =>
  validarTransicion(estado, 'atencion_humana'),
);

// AC13 (recordatorio_programado_en/etc. de US WA 013 NO aplican aquí:
// atencion_humana nunca está en ESTADOS_CON_SEGUIMIENTO) + AC12: cierra la
// conversación vieja (motivo_cierre='solicitud_tutor') y crea la nueva
// DIRECTO en 'esperando_menu' (no 'acumulando'): no hay ningún texto que
// agrupar — el comando de reactivación nunca se guarda (AC13) — así que
// "mostrar el menú" es un efecto inmediato de este mismo evento, igual
// criterio que un comando de menú sobre una conversación ya existente
// (US WA 004 AC2/disparaMenuInmediato), no algo que espere la ventana de
// 10s. El índice único parcial (phone_number_id, telefono_normalizado)
// WHERE estado <> 'cerrada' es lo que exige cerrar la vieja ANTES de
// insertar la nueva, dentro de la MISMA transacción.
async function reactivarPorComandoDelTutor(
  trx,
  conversacionVieja,
  { ahora, phoneNumberId, telefonoNormalizado },
) {
  await trx('conversaciones_whatsapp')
    .where({ id: conversacionVieja.id })
    .whereIn('estado', ['atencion_humana'])
    .update({
      estado: 'cerrada',
      cerrado_en: ahora,
      motivo_cierre: 'solicitud_tutor',
      updated_at: ahora,
    });

  const [nueva] = await trx('conversaciones_whatsapp')
    .insert({
      phone_number_id: phoneNumberId,
      telefono_normalizado: telefonoNormalizado,
      estado: 'esperando_menu',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
      recordatorio_programado_en: new Date(
        ahora.getTime() + env.whatsapp.flujoRecordatorioMinutos * 60000,
      ),
    })
    .onConflict(trx.raw(`(phone_number_id, telefono_normalizado) WHERE estado <> 'cerrada'`))
    .ignore()
    .returning('*');

  return nueva ?? null;
}

// AC16/AC17: mismo criterio que reactivarPorComandoDelTutor, pero la nueva
// conversación nace 'acumulando' (no 'esperando_menu') — a diferencia del
// comando de reactivación, aquí SÍ hay un mensaje ordinario real que debe
// entrar a la ventana normal de agrupación de 10s (AC17), no un salto
// directo al menú.
async function cerrarPorVencimientoYCrearNueva(
  trx,
  conversacionVieja,
  { ahora, phoneNumberId, telefonoNormalizado },
) {
  await trx('conversaciones_whatsapp')
    .where({ id: conversacionVieja.id })
    .whereIn('estado', ['atencion_humana'])
    .update({
      estado: 'cerrada',
      cerrado_en: ahora,
      motivo_cierre: 'vencimiento_atencion_humana',
      updated_at: ahora,
    });

  const [nueva] = await trx('conversaciones_whatsapp')
    .insert({
      phone_number_id: phoneNumberId,
      telefono_normalizado: telefonoNormalizado,
      estado: 'acumulando',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
      procesar_despues_de: new Date(ahora.getTime() + DEBOUNCE_ACUMULANDO_MS),
    })
    .onConflict(trx.raw(`(phone_number_id, telefono_normalizado) WHERE estado <> 'cerrada'`))
    .ignore()
    .returning('*');

  return nueva ?? null;
}

// ---------------------------------------------------------------------
// smb_message_echoes — mensaje manual enviado por una persona desde la
// app/dispositivos vinculados de WhatsApp Business de Omega (AC25-AC31,
// AC35, AC36).
// ---------------------------------------------------------------------

// AC35: idempotencia por el propio identificador del echo — se inserta
// como un mensaje_whatsapp DIRECCIÓN 'saliente' (nunca 'entrante': esto no
// lo escribió el tutor) con el mismo índice UNIQUE de whatsapp_message_id
// ya usado para AC4/AC5 de US WA 001 — una reentrega del mismo id no
// vuelve a tocar la conversación ni a duplicar nada (mismo idioma
// ON CONFLICT DO NOTHING que crearMensajePendiente/crearMensajeIgnorado).
// Nunca se guarda el texto que la persona escribió (mismo criterio "solo
// metadatos" del resto de esta historia) — este NO es un mensaje del bot
// ni requiere auditoría de contenido, el personal ya lo mandó por su
// cuenta desde la app oficial de Meta.
async function registrarEchoManual(
  trx,
  { whatsappMessageId, telefonoTutor, phoneNumberId, tipoMensaje, recibidoEn },
) {
  const [row] = await trx('mensajes_whatsapp')
    .insert({
      whatsapp_message_id: whatsappMessageId,
      telefono_origen: telefonoTutor,
      tipo_mensaje: tipoMensaje,
      direccion: 'saliente',
      estado_procesamiento: 'eco_manual_omega',
      mensaje_recibido: null,
      media_id: null,
      mime_type: null,
      categoria_clasificacion: null,
      tokens_entrada: 0,
      tokens_salida: 0,
      recibido_en: recibidoEn,
      procesado_en: recibidoEn,
    })
    .onConflict('whatsapp_message_id')
    .ignore()
    .returning('id');
  if (!row) return { esNuevo: false, conversacionId: null, transicion: 'reentrega' };

  const existente = await trx('conversaciones_whatsapp')
    .where({ phone_number_id: phoneNumberId, telefono_normalizado: telefonoTutor })
    .whereNot('estado', 'cerrada')
    .first();

  const intervalo = trx.raw(
    `?::timestamptz + interval '${Number(env.whatsapp.atencionHumanaHoras)} hours'`,
    [recibidoEn],
  );

  if (!existente) {
    // AC26: sin conversación automatizada abierta — se crea DIRECTO en
    // atencion_humana, sin pasar por acumulando ni por ningún flujo del
    // bot.
    const [creada] = await trx('conversaciones_whatsapp')
      .insert({
        phone_number_id: phoneNumberId,
        telefono_normalizado: telefonoTutor,
        estado: 'atencion_humana',
        primer_fragmento_en: recibidoEn,
        ultima_interaccion_en: recibidoEn,
        atencion_humana_desde: recibidoEn, // AC28: fecha de Meta, no la del servidor.
        atencion_humana_hasta: intervalo,
        origen_atencion_humana: 'iniciada_por_omega',
      })
      .onConflict(trx.raw(`(phone_number_id, telefono_normalizado) WHERE estado <> 'cerrada'`))
      .ignore()
      .returning('*');
    if (creada) {
      await trx('mensajes_whatsapp').where({ id: row.id }).update({ conversacion_id: creada.id });
      return { esNuevo: true, conversacionId: creada.id, transicion: 'creada_atencion_humana' };
    }
    // Condición de carrera real pero rara: un mensaje entrante del tutor
    // ganó el INSERT justo antes que este echo — se cae a la rama de abajo
    // (releer y tratar como "ya existía").
  }

  const conversacion =
    existente ??
    (await trx('conversaciones_whatsapp')
      .where({ phone_number_id: phoneNumberId, telefono_normalizado: telefonoTutor })
      .whereNot('estado', 'cerrada')
      .first());

  await trx('mensajes_whatsapp').where({ id: row.id }).update({ conversacion_id: conversacion.id });

  if (conversacion.estado === 'atencion_humana') {
    // AC31: otro mensaje manual de Omega mientras YA está en atencion_humana
    // — no reinicia ni extiende la ventana original.
    return { esNuevo: true, conversacionId: conversacion.id, transicion: 'ya_en_atencion_humana' };
  }

  if (!validarTransicion(conversacion.estado, 'atencion_humana')) {
    return { esNuevo: true, conversacionId: conversacion.id, transicion: 'no_permitida' };
  }

  // AC27/AC28: transición desde una conversación automatizada abierta —
  // conserva su historial (nunca se cierra ni se recrea, a diferencia del
  // ciclo de reactivación de AC12/AC16) y suspende el procesamiento
  // automático posterior.
  await trx('conversaciones_whatsapp').where({ id: conversacion.id }).update({
    estado: 'atencion_humana',
    atencion_humana_desde: recibidoEn,
    atencion_humana_hasta: intervalo,
    origen_atencion_humana: 'iniciada_por_omega',
    flujo_actual: null,
    paso_actual: null,
    updated_at: recibidoEn,
  });
  // AC36: cancela solo las respuestas conversacionales automáticas aún no
  // enviadas — nunca resultados de laboratorio u otros envíos
  // transaccionales independientes.
  await cancelarEnviosConversacionalesPendientes(trx, conversacion.id);

  return {
    esNuevo: true,
    conversacionId: conversacion.id,
    transicion: 'transicionada_atencion_humana',
  };
}

module.exports = {
  solicitarAtencionHumana,
  reclamarSolicitudPendiente,
  marcarSolicitudOutbox,
  marcarSolicitudFallidaReintentable,
  confirmarTransferenciaEnviada,
  reclamarAtencionHumanaVencida,
  cancelarEnviosConversacionalesPendientes,
  crearMensajeIgnorado,
  reactivarPorComandoDelTutor,
  cerrarPorVencimientoYCrearNueva,
  registrarEchoManual,
  ESTADOS_QUE_PERMITEN_ATENCION_HUMANA,
};
