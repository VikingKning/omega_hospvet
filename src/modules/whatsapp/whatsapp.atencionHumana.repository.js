const db = require('../../config/database');
const env = require('../../config/env');
const { TRANSICIONES, validarTransicion } = require('./whatsapp.estados');

const DEBOUNCE_ACUMULANDO_MS = env.whatsapp.agrupacionSegundos * 1000;


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

async function marcarSolicitudOutbox(solicitudId, outboxId, trx) {
  const conexion = trx ?? db;
  await conexion('solicitudes_atencion_humana')
    .where({ id: solicitudId })
    .update({ outbox_id: outboxId, actualizado_en: conexion.fn.now() });
}

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
    const [creada] = await trx('conversaciones_whatsapp')
      .insert({
        phone_number_id: phoneNumberId,
        telefono_normalizado: telefonoTutor,
        estado: 'atencion_humana',
        primer_fragmento_en: recibidoEn,
        ultima_interaccion_en: recibidoEn,
        atencion_humana_desde: recibidoEn, // Conserva la fecha reportada por Meta.
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
  }

  const conversacion =
    existente ??
    (await trx('conversaciones_whatsapp')
      .where({ phone_number_id: phoneNumberId, telefono_normalizado: telefonoTutor })
      .whereNot('estado', 'cerrada')
      .first());

  await trx('mensajes_whatsapp').where({ id: row.id }).update({ conversacion_id: conversacion.id });

  if (conversacion.estado === 'atencion_humana') {
    return { esNuevo: true, conversacionId: conversacion.id, transicion: 'ya_en_atencion_humana' };
  }

  if (!validarTransicion(conversacion.estado, 'atencion_humana')) {
    return { esNuevo: true, conversacionId: conversacion.id, transicion: 'no_permitida' };
  }

  await trx('conversaciones_whatsapp').where({ id: conversacion.id }).update({
    estado: 'atencion_humana',
    atencion_humana_desde: recibidoEn,
    atencion_humana_hasta: intervalo,
    origen_atencion_humana: 'iniciada_por_omega',
    flujo_actual: null,
    paso_actual: null,
    updated_at: recibidoEn,
  });
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
