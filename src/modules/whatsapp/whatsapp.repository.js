const db = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { TRANSICIONES, validarTransicion, ESTADOS_CON_SEGUIMIENTO } = require('./whatsapp.estados');
const menu = require('./whatsapp.menu');
const laboratorioConsulta = require('./whatsapp.laboratorioConsulta');
const atencionHumana = require('./whatsapp.atencionHumana.repository');
const consentimiento = require('./whatsapp.consentimiento.repository');
// Módulo de configuración, no de whatsapp: sin dependencias hacia whatsapp
// (por eso es seguro requerirlo aquí sin crear un ciclo con outbox.js).
const configuracionService = require('../configuracion/configuracion.service');

const PIPELINE_NUEVO = 'conversacional_nuevo';
const PIPELINE_ANTERIOR = 'flujo_anterior';

const DEBOUNCE_ACUMULANDO_MS = env.whatsapp.agrupacionSegundos * 1000;
const DEBOUNCE_EMERGENCIA_MS = env.whatsapp.agrupacionEmergenciaSegundos * 1000;

function proximoProcesamiento(conexion, debounceMs) {
  return conexion.raw("now() + (? * interval '1 millisecond')", [debounceMs]);
}

async function crearMensajePendiente(
  {
    whatsappMessageId,
    telefonoOrigen,
    tipoMensaje,
    contenido,
    mediaId,
    mimeType,
    recibidoEn,
    pipelineAsignado = PIPELINE_NUEVO,
  },
  trx,
) {
  const [row] = await trx('mensajes_whatsapp')
    .insert({
      whatsapp_message_id: whatsappMessageId,
      telefono_origen: telefonoOrigen,
      tipo_mensaje: tipoMensaje,
      mensaje_recibido: contenido ?? null,
      media_id: mediaId ?? null,
      mime_type: mimeType ?? null,
      direccion: 'entrante',
      estado_procesamiento: 'pendiente',
      categoria_clasificacion: null,
      tokens_entrada: 0,
      tokens_salida: 0,
      recibido_en: recibidoEn,
      pipeline_asignado: pipelineAsignado,
    })
    .onConflict('whatsapp_message_id')
    .ignore()
    .returning('id');
  return row ? { id: row.id, esNuevo: true } : { id: null, esNuevo: false };
}

async function buscarOCrearConversacionAbierta(trx, { phoneNumberId, telefonoNormalizado, ahora }) {
  const existente = await trx('conversaciones_whatsapp')
    .where({ phone_number_id: phoneNumberId, telefono_normalizado: telefonoNormalizado })
    .whereNot('estado', 'cerrada')
    .first();
  if (existente) return { conversacion: existente, esNueva: false };

  const [creada] = await trx('conversaciones_whatsapp')
    .insert({
      phone_number_id: phoneNumberId,
      telefono_normalizado: telefonoNormalizado,
      estado: 'acumulando',
      primer_fragmento_en: ahora,
      ultima_interaccion_en: ahora,
      procesar_despues_de: proximoProcesamiento(trx, DEBOUNCE_ACUMULANDO_MS),
    })
    .onConflict(trx.raw(`(phone_number_id, telefono_normalizado) WHERE estado <> 'cerrada'`))
    .ignore()
    .returning('*');
  if (creada) return { conversacion: creada, esNueva: true };

  const ganadora = await trx('conversaciones_whatsapp')
    .where({ phone_number_id: phoneNumberId, telefono_normalizado: telefonoNormalizado })
    .whereNot('estado', 'cerrada')
    .first();
  return { conversacion: ganadora, esNueva: false };
}

async function aplicarReglasDeInteraccion(trx, conversacion, { ahora, contenido, tipoMensaje }) {
  const cambios = { ultima_interaccion_en: ahora, updated_at: ahora };

  const esComandoMenu = Boolean(contenido) && menu.esComandoMenu(contenido);
  const disparaMenu = esComandoMenu && validarTransicion(conversacion.estado, 'esperando_menu');
  const esSeleccionInteractiva =
    tipoMensaje === 'interactive_list_reply' || tipoMensaje === 'interactive_button_reply';
  let seguimientoAccion = null;
  let rutaResuelta = null;
  let seleccionInvalida = false;
  let labAccion = null;
  let labDatos = null;
  let disparaSolicitudEmergencia = false;

  if (disparaMenu) {
    Object.assign(cambios, {
      estado: 'esperando_menu',
      flujo_actual: null,
      paso_actual: null,
      procesar_despues_de: null,
    });
  } else if (esSeleccionInteractiva && conversacion.estado === 'esperando_menu') {
    const ruta = menu.RUTA_POR_MENU_ID[contenido];
    if (ruta) {
      rutaResuelta = ruta;
      if (
        ruta === 'resultados_laboratorio' &&
        validarTransicion(conversacion.estado, 'flujo_activo')
      ) {
        Object.assign(cambios, {
          estado: 'flujo_activo',
          flujo_actual: 'consulta_laboratorio',
          paso_actual: 'confirmando_telefono',
          intentos_validacion_lab: null,
        });
        labAccion = 'iniciar';
      } else if (ruta === 'emergencia') {
        disparaSolicitudEmergencia = true;
      }
    } else {
      seleccionInvalida = true;
    }
  } else if (
    esSeleccionInteractiva &&
    menu.esIdDeMenu(contenido) &&
    conversacion.estado !== 'atencion_humana'
  ) {
    seleccionInvalida = true;
  } else if (conversacion.flujo_actual === 'consulta_laboratorio') {
    const resultado = await laboratorioConsulta.procesarPaso(trx, conversacion, {
      contenido,
      tipoMensaje,
      ahora,
    });
    Object.assign(cambios, resultado.cambios);
    labAccion = resultado.labAccion;
    labDatos = resultado.labDatos ?? null;
  } else if (
    ESTADOS_CON_SEGUIMIENTO.includes(conversacion.estado) &&
    conversacion.recordatorio_enviado_en
  ) {
    if (tipoMensaje === 'interactive_button_reply' && contenido === menu.RESPUESTA_VOLVER_MENU) {
      seguimientoAccion = 'volver_menu';
      Object.assign(cambios, { estado: 'esperando_menu', flujo_actual: null, paso_actual: null });
    } else if (
      tipoMensaje === 'interactive_button_reply' &&
      contenido !== menu.RESPUESTA_CONTINUAR
    ) {
      seguimientoAccion = 'invalido';
    } else if (
      tipoMensaje === 'interactive_button_reply' &&
      contenido === menu.RESPUESTA_CONTINUAR
    ) {
      seguimientoAccion = 'continuar';
    } else {
      seguimientoAccion = 'continuar_texto';
    }
  } else if (conversacion.estado === 'acumulando') {
    cambios.procesar_despues_de = proximoProcesamiento(trx, DEBOUNCE_ACUMULANDO_MS);
  } else if (conversacion.estado === 'esperando_menu') {
    cambios.procesar_despues_de = proximoProcesamiento(trx, DEBOUNCE_ACUMULANDO_MS);
  } else if (conversacion.estado === 'procesando') {
    const debounceMs =
      conversacion.flujo_actual === 'emergencia' &&
      conversacion.paso_actual === 'esperando_descripcion'
        ? DEBOUNCE_EMERGENCIA_MS
        : DEBOUNCE_ACUMULANDO_MS;
    cambios.procesar_despues_de = proximoProcesamiento(trx, debounceMs);
  }

  const estadoResultante = cambios.estado ?? conversacion.estado;
  const pasoActualResultante =
    'paso_actual' in cambios ? cambios.paso_actual : conversacion.paso_actual;
  const flujoActualResultante =
    'flujo_actual' in cambios ? cambios.flujo_actual : conversacion.flujo_actual;

  if (seguimientoAccion === 'continuar_texto' && estadoResultante === 'esperando_menu') {
    cambios.procesar_despues_de = proximoProcesamiento(trx, DEBOUNCE_ACUMULANDO_MS);
  }

  if (estadoResultante === 'flujo_activo' && pasoActualResultante === 'esperando_descripcion') {
    const debounceMs =
      flujoActualResultante === 'emergencia' ? DEBOUNCE_EMERGENCIA_MS : DEBOUNCE_ACUMULANDO_MS;
    cambios.procesar_despues_de = proximoProcesamiento(trx, debounceMs);
  }

  if (ESTADOS_CON_SEGUIMIENTO.includes(estadoResultante)) {
    cambios.recordatorio_programado_en = new Date(
      ahora.getTime() + env.whatsapp.flujoRecordatorioMinutos * 60000,
    );
    cambios.recordatorio_enviado_en = null;
    cambios.recordatorio_reclamado_en = null;
    cambios.flujo_expira_en = null;
  }

  await trx('conversaciones_whatsapp').where({ id: conversacion.id }).update(cambios);
  return {
    disparaMenu,
    seguimientoAccion,
    rutaResuelta,
    seleccionInvalida,
    labAccion,
    labDatos,
    disparaSolicitudEmergencia,
    estadoResultante,
    flujoActualResultante,
    pasoActualResultante,
    grupoMedioPendienteId: conversacion.grupo_medio_pendiente_id ?? null,
  };
}

async function registrarMensajeYConversacion({
  whatsappMessageId,
  telefonoOrigen,
  phoneNumberId,
  telefonoNormalizado,
  tipoMensaje,
  contenido,
  mediaId,
  mimeType,
  tituloInteractivo,
  recibidoEn,
  pipelineAsignado = PIPELINE_NUEVO,
}) {
  const evento = {
    whatsappMessageId,
    telefonoOrigen,
    phoneNumberId,
    telefonoNormalizado,
    tipoMensaje,
    contenido,
    mediaId,
    mimeType,
    tituloInteractivo,
    recibidoEn,
    pipelineAsignado,
  };
  return db.transaction(async (trx) => {
    const [mensajeExistente] = await trx('mensajes_whatsapp')
      .where({ whatsapp_message_id: whatsappMessageId })
      .update({ reentregas_meta: trx.raw('reentregas_meta + 1') })
      .returning([
        'id',
        'conversacion_id',
        'categoria_clasificacion',
        'group_id',
        'pipeline_asignado',
      ]);
    if (mensajeExistente) {
      return {
        id: mensajeExistente.id,
        esNuevo: false,
        conversacionId: mensajeExistente.conversacion_id,
        rutaResuelta: mensajeExistente.categoria_clasificacion,
        groupId: mensajeExistente.group_id,
        pipelineAsignado: mensajeExistente.pipeline_asignado,
      };
    }

    if (pipelineAsignado === PIPELINE_ANTERIOR) {
      const creado = await crearMensajePendiente(evento, trx);
      if (creado.esNuevo) {
        return {
          ...creado,
          conversacionId: null,
          groupId: null,
          pipelineAsignado: PIPELINE_ANTERIOR,
        };
      }
      const [ganador] = await trx('mensajes_whatsapp')
        .where({ whatsapp_message_id: whatsappMessageId })
        .update({ reentregas_meta: trx.raw('reentregas_meta + 1') })
        .returning(['id', 'conversacion_id', 'group_id', 'pipeline_asignado']);
      return {
        id: ganador.id,
        esNuevo: false,
        conversacionId: ganador.conversacion_id,
        groupId: ganador.group_id,
        pipelineAsignado: ganador.pipeline_asignado,
      };
    }

    const existente = await trx('conversaciones_whatsapp')
      .where({ phone_number_id: phoneNumberId, telefono_normalizado: telefonoNormalizado })
      .whereNot('estado', 'cerrada')
      .forUpdate()
      .first();

    if (existente && existente.estado === 'atencion_humana') {
      return procesarMensajeEnAtencionHumana(trx, existente, evento);
    }

    if (existente) {
      const transferenciaPendiente = await trx('solicitudes_atencion_humana')
        .where({ conversacion_id: existente.id })
        .whereIn('estado', ['pendiente', 'enviando', 'fallida_reintentable'])
        .first('id');
      if (transferenciaPendiente) {
        const { id, esNuevo } = await atencionHumana.crearMensajeIgnorado(trx, {
          whatsappMessageId,
          telefonoOrigen,
          tipoMensaje,
          conversacionId: existente.id,
          recibidoEn,
          estadoProcesamiento: 'ignorado_atencion_humana',
        });
        return {
          ...RESULTADO_ATENCION_HUMANA_BASE,
          id,
          esNuevo,
          conversacionId: existente.id,
          estadoResultante: existente.estado,
        };
      }
    }

    const { conversacion, esNueva } = existente
      ? { conversacion: existente, esNueva: false }
      : await buscarOCrearConversacionAbierta(trx, {
          phoneNumberId,
          telefonoNormalizado,
          ahora: recibidoEn,
        });

    if (pipelineAsignado === PIPELINE_NUEVO) {
      const resultadoConsentimiento = await procesarConsentimientoLfpdppp(trx, {
        conversacion,
        evento,
      });
      if (resultadoConsentimiento) return resultadoConsentimiento;
    }

    return procesarMensajeSobreConversacion(trx, { conversacion, esNueva, evento });
  });
}

// LFPDPPP: gate de consentimiento antes de cualquier otro procesamiento.
// Se resuelve aquí (nivel mensaje, antes de agrupar) y no en el router de
// grupos — mismo criterio que atencion_humana un poco más arriba en esta
// función: un mensaje que no debe procesarse normalmente nunca debe llegar
// a formar parte de un grupo (ver Fixes #1/#2/#4 de esta misma sesión sobre
// respuestas interactivas huérfanas contaminando grupos). Devuelve `null`
// cuando el consentimiento ya está aceptado y el flujo normal debe seguir;
// en cualquier otro caso devuelve el resultado final del mensaje.
async function procesarConsentimientoLfpdppp(trx, { conversacion, evento }) {
  // Sin aviso de privacidad configurado, la funcionalidad completa queda
  // apagada — el flujo se comporta exactamente igual que antes de que
  // existiera este gate.
  const avisoConfigurado = await configuracionService.obtenerVersionVigenteParaEnvio();
  if (!avisoConfigurado) return null;

  const {
    telefonoNormalizado,
    tipoMensaje,
    contenido,
    whatsappMessageId,
    telefonoOrigen,
    recibidoEn,
  } = evento;
  const { estado, fila } = await consentimiento.evaluarEstado(telefonoNormalizado, trx);

  if (estado === consentimiento.ESTADOS.ACEPTADO) return null;

  if (
    estado === consentimiento.ESTADOS.PENDIENTE_VIGENTE &&
    consentimiento.esRespuestaBoton(tipoMensaje, contenido)
  ) {
    const acepto = contenido === consentimiento.BOTON_ACEPTO_ID;
    await consentimiento.resolverPendiente({ id: fila.id, acepto, wamid: whatsappMessageId }, trx);
    const { id, esNuevo } = await atencionHumana.crearMensajeIgnorado(trx, {
      whatsappMessageId,
      telefonoOrigen,
      tipoMensaje,
      conversacionId: conversacion.id,
      recibidoEn,
      estadoProcesamiento: 'resuelto_lfpdppp',
    });
    return {
      ...RESULTADO_ATENCION_HUMANA_BASE,
      id,
      esNuevo,
      conversacionId: conversacion.id,
      estadoResultante: conversacion.estado,
      disparaAtencionHumanaConsentimiento: !acepto,
    };
  }

  if (estado === consentimiento.ESTADOS.NECESITA_PREGUNTAR) {
    const propietario = await trx('propietarios')
      .where({ telefono: telefonoNormalizado.slice(-10) })
      .first('id');
    await consentimiento.insertarPendiente(
      {
        telefono: telefonoNormalizado,
        propietarioId: propietario?.id ?? null,
        avisoEnviadoEn: recibidoEn,
        versionAviso: avisoConfigurado.version,
      },
      trx,
    );
  }

  // NECESITA_PREGUNTAR, PENDIENTE_VIGENTE (mensaje que no es el botón) o
  // RECHAZADO_RECIENTE: en los tres casos este mensaje entrante se ignora.
  const { id, esNuevo } = await atencionHumana.crearMensajeIgnorado(trx, {
    whatsappMessageId,
    telefonoOrigen,
    tipoMensaje,
    conversacionId: conversacion.id,
    recibidoEn,
    // varchar(30): 'ignorado_consentimiento_pendiente'/'_rechazado' no caben.
    estadoProcesamiento:
      estado === consentimiento.ESTADOS.RECHAZADO_RECIENTE
        ? 'ignorado_lfpdppp_rechazo'
        : 'ignorado_lfpdppp_pendiente',
  });
  return {
    ...RESULTADO_ATENCION_HUMANA_BASE,
    id,
    esNuevo,
    conversacionId: conversacion.id,
    estadoResultante: conversacion.estado,
    necesitaEnviarAvisoLfpdppp: estado === consentimiento.ESTADOS.NECESITA_PREGUNTAR,
  };
}

const RESULTADO_ATENCION_HUMANA_BASE = {
  disparaMenuInmediato: false,
  seguimientoAccion: null,
  rutaResuelta: null,
  seleccionInvalida: false,
  labAccion: null,
  labDatos: null,
  disparaSolicitudEmergencia: false,
};

async function procesarMensajeEnAtencionHumana(trx, conversacion, evento) {
  // Un rechazo del aviso de privacidad NO es una atención humana genérica:
  // ni "escribe 'menu' para recuperar al bot" ni "se venció la ventana,
  // sigue normal" deben aplicar aquí — mientras el rechazo siga vigente
  // (evaluarEstado, 24h) el bot debe seguir en silencio, y al re-preguntar
  // debe ser el aviso de privacidad, no el menú principal.
  const esPorConsentimiento = await atencionHumana.tieneSolicitudPorConsentimiento(
    conversacion.id,
    trx,
  );

  const vencidaRow = await trx('conversaciones_whatsapp')
    .where({ id: conversacion.id })
    .first(trx.raw(`(atencion_humana_hasta <= now()) as vencida`));

  if (vencidaRow?.vencida) {
    const nueva = await atencionHumana.cerrarPorVencimientoYCrearNueva(trx, conversacion, {
      ahora: evento.recibidoEn,
      phoneNumberId: evento.phoneNumberId,
      telefonoNormalizado: evento.telefonoNormalizado,
    });
    if (esPorConsentimiento) {
      const resultadoConsentimiento = await procesarConsentimientoLfpdppp(trx, {
        conversacion: nueva,
        evento,
      });
      if (resultadoConsentimiento) return resultadoConsentimiento;
    }
    return procesarMensajeSobreConversacion(trx, {
      conversacion: nueva,
      esNueva: true,
      evento,
    });
  }

  const esComandoReactivacion =
    !esPorConsentimiento &&
    evento.tipoMensaje === 'text' &&
    Boolean(evento.contenido) &&
    menu.esComandoMenu(evento.contenido);

  if (esComandoReactivacion) {
    const { id, esNuevo } = await atencionHumana.crearMensajeIgnorado(trx, {
      whatsappMessageId: evento.whatsappMessageId,
      telefonoOrigen: evento.telefonoOrigen,
      tipoMensaje: evento.tipoMensaje,
      conversacionId: conversacion.id,
      recibidoEn: evento.recibidoEn,
      estadoProcesamiento: 'comando_reactivacion_bot',
    });
    if (!esNuevo) {
      return {
        ...RESULTADO_ATENCION_HUMANA_BASE,
        id,
        esNuevo,
        conversacionId: conversacion.id,
        estadoResultante: conversacion.estado,
      };
    }

    const nueva = await atencionHumana.reactivarPorComandoDelTutor(trx, conversacion, {
      ahora: evento.recibidoEn,
      phoneNumberId: evento.phoneNumberId,
      telefonoNormalizado: evento.telefonoNormalizado,
    });
    return {
      ...RESULTADO_ATENCION_HUMANA_BASE,
      id,
      esNuevo: true,
      conversacionId: nueva ? nueva.id : conversacion.id,
      disparaMenuInmediato: Boolean(nueva),
      estadoResultante: nueva ? 'esperando_menu' : conversacion.estado,
    };
  }

  const { id, esNuevo } = await atencionHumana.crearMensajeIgnorado(trx, {
    whatsappMessageId: evento.whatsappMessageId,
    telefonoOrigen: evento.telefonoOrigen,
    tipoMensaje: evento.tipoMensaje,
    conversacionId: conversacion.id,
    recibidoEn: evento.recibidoEn,
    estadoProcesamiento: 'ignorado_atencion_humana',
  });
  return {
    ...RESULTADO_ATENCION_HUMANA_BASE,
    id,
    esNuevo,
    conversacionId: conversacion.id,
    estadoResultante: conversacion.estado,
  };
}

async function procesarMensajeSobreConversacion(trx, { conversacion, esNueva, evento }) {
  const { id, esNuevo } = await crearMensajePendiente(
    {
      whatsappMessageId: evento.whatsappMessageId,
      telefonoOrigen: evento.telefonoOrigen,
      tipoMensaje: evento.tipoMensaje,
      contenido: evento.contenido,
      mediaId: evento.mediaId,
      mimeType: evento.mimeType,
      recibidoEn: evento.recibidoEn,
      pipelineAsignado: evento.pipelineAsignado,
    },
    trx,
  );
  if (!esNuevo) {
    const mensajeExistente = await trx('mensajes_whatsapp')
      .where({ whatsapp_message_id: evento.whatsappMessageId })
      .first('id', 'conversacion_id', 'categoria_clasificacion', 'group_id');
    return {
      id: mensajeExistente?.id ?? id,
      esNuevo: false,
      conversacionId: mensajeExistente?.conversacion_id ?? conversacion.id,
      rutaResuelta: mensajeExistente?.categoria_clasificacion ?? null,
      groupId: mensajeExistente?.group_id ?? null,
      pipelineAsignado: mensajeExistente?.pipeline_asignado ?? evento.pipelineAsignado,
    };
  }

  const { contenido, tituloInteractivo, tipoMensaje, recibidoEn } = evento;
  let disparaMenuInmediato = false;
  let seguimientoAccion = null;
  let estadoResultante = conversacion.estado;
  let flujoActualResultante = conversacion.flujo_actual;
  let pasoActualResultante = conversacion.paso_actual;
  let grupoMedioPendienteId = conversacion.grupo_medio_pendiente_id ?? null;
  let groupId = null;
  let rutaResuelta = null;
  let seleccionInvalida = false;
  let labAccion = null;
  let labDatos = null;
  let disparaSolicitudEmergencia = false;
  const comandoMenuEnConversacionNueva =
    esNueva && tipoMensaje === 'text' && Boolean(contenido) && menu.esComandoMenu(contenido);
  if (!esNueva || comandoMenuEnConversacionNueva) {
    ({
      disparaMenu: disparaMenuInmediato,
      seguimientoAccion,
      rutaResuelta,
      seleccionInvalida,
      labAccion,
      labDatos,
      disparaSolicitudEmergencia,
      estadoResultante,
      flujoActualResultante,
      pasoActualResultante,
      grupoMedioPendienteId,
    } = await aplicarReglasDeInteraccion(trx, conversacion, {
      ahora: recibidoEn,
      contenido,
      tipoMensaje,
    }));
  }
  await trx('mensajes_whatsapp').where({ id }).update({ conversacion_id: conversacion.id });

  if (rutaResuelta) {
    await trx('mensajes_whatsapp').where({ id }).update({
      categoria_clasificacion: rutaResuelta,
      estado_procesamiento: 'procesado',
      procesado_en: trx.fn.now(),
      ruta_enrutamiento: 'respuesta_interactiva',
      resultado_decision: rutaResuelta,
      decision_en: trx.fn.now(),
    });
    if (rutaResuelta === 'recepcion') {
      const [grupo] = await trx('grupos_whatsapp')
        .insert({
          conversacion_id: conversacion.id,
          texto_consolidado: contenido,
          estado: 'procesado',
          procesado_en: trx.fn.now(),
          pipeline_asignado: PIPELINE_NUEVO,
          ruta_enrutamiento: 'respuesta_interactiva',
          categoria_resuelta: 'recepcion',
          intencion_resuelta: 'transferir_recepcion',
          resultado_decision: 'atencion_humana',
          es_emergencia_resuelta: false,
          tokens_entrada: 0,
          tokens_salida: 0,
          llamadas_claude: 0,
          resultado_claude: 'no_usado',
          enrutado_en: trx.fn.now(),
        })
        .returning('group_id');
      groupId = grupo.group_id;
      await trx('mensajes_whatsapp').where({ id }).update({ group_id: groupId });
    }
  } else if (seleccionInvalida) {
    logger.warn(
      {
        conversacionId: conversacion.id,
        mensajeId: id,
        idRecibido: contenido,
        tituloInteractivo,
      },
      'Selección de menú desconocida, manipulada o vencida (US WA 005 AC9).',
    );
  }

  if (
    disparaMenuInmediato ||
    (seguimientoAccion && seguimientoAccion !== 'continuar_texto') ||
    seleccionInvalida ||
    labAccion ||
    disparaSolicitudEmergencia
  ) {
    const auditoria = disparaMenuInmediato
      ? { ruta_enrutamiento: 'comando_menu', resultado_decision: 'menu' }
      : seleccionInvalida
        ? { ruta_enrutamiento: 'respuesta_interactiva', resultado_decision: 'seleccion_invalida' }
        : labAccion || seguimientoAccion
          ? {
              ruta_enrutamiento: 'flujo_activo',
              resultado_decision: labAccion ?? seguimientoAccion,
            }
          : disparaSolicitudEmergencia
            ? {
                ruta_enrutamiento: 'respuesta_interactiva',
                resultado_decision: 'solicitar_emergencia',
              }
            : {};
    await trx('mensajes_whatsapp')
      .where({ id })
      .update({
        estado_procesamiento: 'procesado',
        procesado_en: trx.fn.now(),
        ...auditoria,
        ...(auditoria.ruta_enrutamiento ? { decision_en: trx.fn.now() } : {}),
      });
  }

  if (labAccion === 'rechazo' || labAccion === 'limite_intentos') {
    logger.warn(
      {
        conversacionId: conversacion.id,
        mensajeId: id,
        resultado: labAccion,
        intentos:
          conversacion.intentos_validacion_lab != null
            ? conversacion.intentos_validacion_lab + 1
            : 1,
      },
      'Intento de validación de folio de laboratorio fallido (US WA 007 AC10/AC11).',
    );
  } else if (labAccion === 'exito') {
    logger.info(
      { conversacionId: conversacion.id, mensajeId: id, resultado: 'exito' },
      'Validación de folio de laboratorio exitosa (US WA 007).',
    );
  }

  return {
    id,
    esNuevo,
    conversacionId: conversacion.id,
    disparaMenuInmediato,
    seguimientoAccion,
    rutaResuelta,
    seleccionInvalida,
    labAccion,
    labDatos,
    disparaSolicitudEmergencia,
    estadoResultante,
    flujoActualResultante,
    pasoActualResultante,
    grupoMedioPendienteId,
    groupId,
    pipelineAsignado: evento.pipelineAsignado,
  };
}

const ESTADOS_QUE_PERMITEN_CIERRE = Object.keys(TRANSICIONES).filter((estado) =>
  validarTransicion(estado, 'cerrada'),
);

async function cerrarConversacion(conversacionId, ahora) {
  const filasAfectadas = await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .whereIn('estado', ESTADOS_QUE_PERMITEN_CIERRE)
    .update({ estado: 'cerrada', cerrado_en: ahora, updated_at: ahora });
  if (filasAfectadas === 0) {
    logger.error(
      { conversacionId },
      'No se pudo cerrar la conversación: transición no permitida desde su estado actual.',
    );
  }
  return filasAfectadas > 0;
}

async function confirmarEnlaceAgendaEnviado(conversacionId, ahora) {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .forUpdate()
      .first('estado');
    if (!conversacion) return false;
    if (conversacion.estado === 'cerrada') return true;
    if (!ESTADOS_QUE_PERMITEN_CIERRE.includes(conversacion.estado)) return false;

    await trx('conversaciones_whatsapp').where({ id: conversacionId }).update({
      estado: 'cerrada',
      cerrado_en: ahora,
      updated_at: ahora,
    });
    return true;
  });
}

async function confirmarAvisoPrivacidadLaboratorioEnviado({ conversacionId, mensajeId, ahora }) {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .forUpdate()
      .first('estado', 'flujo_actual', 'paso_actual');
    if (!conversacion) return false;
    if (conversacion.estado === 'cerrada') return true;
    if (
      conversacion.estado !== 'flujo_activo' ||
      conversacion.flujo_actual !== 'consulta_laboratorio' ||
      !['aviso_privacidad_pendiente', 'esperando_telefono_y_folio'].includes(
        conversacion.paso_actual,
      )
    ) {
      return false;
    }

    await trx('conversaciones_whatsapp').where({ id: conversacionId }).update({
      estado: 'cerrada',
      cerrado_en: ahora,
      flujo_actual: null,
      paso_actual: null,
      intentos_validacion_lab: null,
      procesar_despues_de: null,
      recordatorio_programado_en: null,
      recordatorio_enviado_en: null,
      recordatorio_reclamado_en: null,
      flujo_expira_en: null,
      updated_at: ahora,
    });
    await trx('eventos_metricas_whatsapp')
      .insert({
        clave_evento: `laboratorio:envio_denegado:mensaje:${mensajeId}`,
        tipo_evento: 'envio_resultados_denegado',
        pipeline_asignado: PIPELINE_NUEVO,
        mensaje_id: mensajeId,
        conversacion_id: conversacionId,
        resultado: 'proteccion_datos',
        ocurrido_en: ahora,
      })
      .onConflict('clave_evento')
      .ignore();
    return true;
  });
}

async function finalizarConversacionTrasGrupo(conversacionId, ahora) {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .forUpdate()
      .first('estado');
    if (!conversacion || !ESTADOS_QUE_PERMITEN_CIERRE.includes(conversacion.estado)) return false;
    const siguiente = await trx('mensajes_whatsapp')
      .where({ conversacion_id: conversacionId, estado_procesamiento: 'pendiente' })
      .whereNull('group_id')
      .first('id');
    if (siguiente) {
      await trx('conversaciones_whatsapp').where({ id: conversacionId }).update({
        estado: 'acumulando',
        procesamiento_iniciado_en: null,
        updated_at: ahora,
      });
      return true;
    }
    await trx('conversaciones_whatsapp').where({ id: conversacionId }).update({
      estado: 'cerrada',
      cerrado_en: ahora,
      updated_at: ahora,
    });
    return true;
  });
}

const ESTADOS_QUE_PERMITEN_ESPERANDO_MENU = Object.keys(TRANSICIONES).filter((estado) =>
  validarTransicion(estado, 'esperando_menu'),
);

async function confirmarMenuEnviado(conversacionId, groupId = null) {
  const ahora = new Date();
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .forUpdate()
      .first('estado');
    if (!conversacion || !ESTADOS_QUE_PERMITEN_ESPERANDO_MENU.includes(conversacion.estado)) {
      return false;
    }

    if (groupId) {
      await marcarGrupoProcesado(groupId, trx);
    }

    const siguiente = await trx('mensajes_whatsapp')
      .where({ conversacion_id: conversacionId, estado_procesamiento: 'pendiente' })
      .whereNull('group_id')
      .first('id');
    const cambios = siguiente
      ? {
          estado: 'acumulando',
          procesamiento_iniciado_en: null,
          flujo_actual: null,
          paso_actual: null,
          recordatorio_programado_en: null,
          recordatorio_enviado_en: null,
          recordatorio_reclamado_en: null,
          flujo_expira_en: null,
          updated_at: ahora,
        }
      : {
          estado: 'esperando_menu',
          flujo_actual: null,
          paso_actual: null,
          procesar_despues_de: null,
          recordatorio_programado_en: new Date(
            ahora.getTime() + env.whatsapp.flujoRecordatorioMinutos * 60000,
          ),
          recordatorio_enviado_en: null,
          recordatorio_reclamado_en: null,
          flujo_expira_en: null,
          updated_at: ahora,
        };
    await trx('conversaciones_whatsapp').where({ id: conversacionId }).update(cambios);
    return true;
  });
}

const ESTADOS_QUE_PERMITEN_FLUJO_ACTIVO = Object.keys(TRANSICIONES).filter((estado) =>
  validarTransicion(estado, 'flujo_activo'),
);

async function confirmarGuiaMedioEnviada(conversacionId, groupId) {
  const ahora = new Date();
  return db.transaction(async (trx) => {
    const filasAfectadas = await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .whereIn('estado', ESTADOS_QUE_PERMITEN_FLUJO_ACTIVO)
      .update({
        estado: 'flujo_activo',
        flujo_actual: 'explicacion_medio',
        paso_actual: 'esperando_descripcion',
        grupo_medio_pendiente_id: groupId,
        procesar_despues_de: null,
        recordatorio_programado_en: new Date(
          ahora.getTime() + env.whatsapp.flujoRecordatorioMinutos * 60000,
        ),
        recordatorio_enviado_en: null,
        recordatorio_reclamado_en: null,
        flujo_expira_en: null,
        updated_at: ahora,
      });
    if (filasAfectadas > 0) {
      await trx('grupos_whatsapp')
        .where({ group_id: groupId })
        .update({ estado: 'procesado', procesado_en: ahora });
    }
    return filasAfectadas > 0;
  });
}

async function confirmarEmergenciaSolicitada(conversacionId) {
  const ahora = new Date();
  const filasAfectadas = await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .whereIn('estado', ESTADOS_QUE_PERMITEN_FLUJO_ACTIVO)
    .update({
      estado: 'flujo_activo',
      flujo_actual: 'emergencia',
      paso_actual: 'esperando_descripcion',
      procesar_despues_de: null,
      recordatorio_programado_en: new Date(
        ahora.getTime() + env.whatsapp.flujoRecordatorioMinutos * 60000,
      ),
      recordatorio_enviado_en: null,
      recordatorio_reclamado_en: null,
      flujo_expira_en: null,
      updated_at: ahora,
    });
  return filasAfectadas > 0;
}

async function obtenerClasificacionGrupo(groupId) {
  return db('grupos_whatsapp')
    .where({ group_id: groupId })
    .first(
      'ruta_enrutamiento',
      'categoria_resuelta',
      'intencion_resuelta',
      'resultado_decision',
      'etiqueta_modelo',
      'plantilla_id',
      'slug_resuelto',
      'es_emergencia_resuelta',
      'respuesta_definitiva',
      'clasificado_en',
      'intento_envio_id',
      'tokens_entrada',
      'tokens_salida',
      'llamadas_claude',
      'resultado_claude',
      'clasificacion_reclamo_id',
    );
}

async function reclamarClasificacionGrupo(groupId, reclamoId) {
  return db.transaction(async (trx) => {
    const [grupo] = await trx('grupos_whatsapp')
      .where({ group_id: groupId })
      .whereNull('clasificado_en')
      .andWhere((builder) => {
        builder
          .whereNull('clasificacion_reclamada_en')
          .orWhere(
            'clasificacion_reclamada_en',
            '<=',
            trx.raw(
              `now() - interval '${Number(env.whatsapp.workerReclamoHuerfanoSegundos)} seconds'`,
            ),
          );
      })
      .update({
        clasificacion_reclamo_id: reclamoId,
        clasificacion_reclamada_en: trx.fn.now(),
      })
      .returning('*');
    return grupo ?? null;
  });
}

async function liberarClasificacionGrupo(groupId, reclamoId) {
  await db('grupos_whatsapp')
    .where({ group_id: groupId, clasificacion_reclamo_id: reclamoId })
    .whereNull('clasificado_en')
    .update({ clasificacion_reclamo_id: null, clasificacion_reclamada_en: null });
}

async function persistirClasificacionGrupo(
  trx,
  groupId,
  {
    plantillaId,
    slugResuelto,
    esEmergencia,
    respuestaDefinitiva,
    reclamoId,
    rutaEnrutamiento,
    categoriaResuelta,
    intencionResuelta,
    resultadoDecision,
    etiquetaModelo,
  },
) {
  const [actualizado] = await trx('grupos_whatsapp')
    .where({ group_id: groupId })
    .where({ clasificacion_reclamo_id: reclamoId })
    .whereNull('clasificado_en')
    .update({
      plantilla_id: plantillaId,
      slug_resuelto: slugResuelto,
      es_emergencia_resuelta: esEmergencia,
      respuesta_definitiva: respuestaDefinitiva,
      clasificado_en: trx.fn.now(),
      ruta_enrutamiento: rutaEnrutamiento,
      categoria_resuelta: categoriaResuelta,
      intencion_resuelta: intencionResuelta,
      resultado_decision: resultadoDecision,
      etiqueta_modelo: etiquetaModelo,
      enrutado_en: trx.fn.now(),
      clasificacion_reclamo_id: null,
      clasificacion_reclamada_en: null,
    })
    .returning('*');
  return actualizado ?? null;
}

async function registrarResultadoClaudeGrupo(
  groupId,
  { llamadaReal, resultado, tokensEntrada = 0, tokensSalida = 0, claveIntento },
) {
  await db.transaction(async (trx) => {
    await trx('grupos_whatsapp')
      .where({ group_id: groupId, pipeline_asignado: PIPELINE_NUEVO })
      .update({
        llamadas_claude: trx.raw('llamadas_claude + ?', [llamadaReal ? 1 : 0]),
        tokens_entrada: trx.raw('tokens_entrada + ?', [tokensEntrada]),
        tokens_salida: trx.raw('tokens_salida + ?', [tokensSalida]),
        resultado_claude: resultado,
      });
    await trx('eventos_metricas_whatsapp')
      .insert({
        clave_evento: `claude:grupo:${groupId}:${claveIntento}`,
        tipo_evento: 'claude_resultado',
        pipeline_asignado: PIPELINE_NUEVO,
        grupo_id: groupId,
        resultado,
        ocurrido_en: trx.fn.now(),
      })
      .onConflict('clave_evento')
      .ignore();
  });
}

async function persistirDecisionDeterministaGrupo(
  trx,
  groupId,
  { rutaEnrutamiento, intencionResuelta, resultadoDecision, respuestaDefinitiva },
) {
  const [actualizado] = await trx('grupos_whatsapp')
    .where({ group_id: groupId })
    .whereNull('enrutado_en')
    .update({
      ruta_enrutamiento: rutaEnrutamiento,
      categoria_resuelta: null,
      intencion_resuelta: intencionResuelta,
      resultado_decision: resultadoDecision,
      etiqueta_modelo: null,
      plantilla_id: null,
      slug_resuelto: null,
      es_emergencia_resuelta: false,
      respuesta_definitiva: respuestaDefinitiva ?? null,
      tokens_entrada: 0,
      tokens_salida: 0,
      llamadas_claude: 0,
      resultado_claude: 'no_usado',
      enrutado_en: trx.fn.now(),
    })
    .returning('*');
  if (actualizado) return actualizado;
  return trx('grupos_whatsapp').where({ group_id: groupId }).first();
}

async function vincularIntentoEnvioGrupo(trx, groupId, intentoEnvioId) {
  await trx('grupos_whatsapp')
    .where({ group_id: groupId })
    .whereNull('intento_envio_id')
    .update({ intento_envio_id: intentoEnvioId });
}

async function marcarGrupoProcesado(groupId, trx) {
  const conexion = trx ?? db;
  await conexion('grupos_whatsapp')
    .where({ group_id: groupId })
    .update({ estado: 'procesado', procesado_en: conexion.fn.now() });
  await conexion('mensajes_whatsapp')
    .where({ group_id: groupId, estado_procesamiento: 'pendiente' })
    .update({ estado_procesamiento: 'procesado', procesado_en: conexion.fn.now() });
}

async function insertarEmergenciaConfirmada(
  trx,
  { conversacionId, groupId, plantillaId, slug, respuestaDefinitiva, intentoEnvioId },
) {
  const [creada] = await trx('emergencias_confirmadas')
    .insert({
      conversacion_id: conversacionId,
      group_id: groupId,
      plantilla_id: plantillaId,
      slug,
      es_emergencia: true,
      respuesta_definitiva: respuestaDefinitiva,
      intento_envio_id: intentoEnvioId,
    })
    .onConflict('group_id')
    .ignore()
    .returning('*');
  return creada ?? (await trx('emergencias_confirmadas').where({ group_id: groupId }).first());
}

async function finalizarExplicacionMedio(conversacionId, grupoTextoId, grupoMedioId) {
  const ahora = new Date();
  return db.transaction(async (trx) => {
    await trx('grupos_whatsapp')
      .where({ group_id: grupoTextoId })
      .update({ grupo_origen_id: grupoMedioId });
    await trx('conversaciones_whatsapp')
      .where({ id: conversacionId })
      .whereIn('estado', ESTADOS_QUE_PERMITEN_CIERRE)
      .update({
        flujo_actual: null,
        paso_actual: null,
        grupo_medio_pendiente_id: null,
        updated_at: ahora,
      });
  });
}

async function obtenerContextoDeConversacion(conversacionId) {
  const fila = await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .first(
      'estado',
      'telefono_normalizado',
      'flujo_actual',
      'paso_actual',
      'grupo_medio_pendiente_id',
    );
  if (!fila) return null;
  return {
    estado: fila.estado,
    telefonoNormalizado: fila.telefono_normalizado,
    flujoActual: fila.flujo_actual,
    pasoActual: fila.paso_actual,
    grupoMedioPendienteId: fila.grupo_medio_pendiente_id,
  };
}

async function reclamarConversacionVencida({ segundosRecuperacion }) {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .where((b) => {
        b.where((estado) => {
          estado.where('estado', 'acumulando').andWhere('procesar_despues_de', '<=', trx.fn.now());
        })
          .orWhere((estado) => {
            estado
              .where('estado', 'procesando')
              .andWhere(
                'procesamiento_iniciado_en',
                '<',
                trx.raw(`now() - interval '${Number(segundosRecuperacion)} seconds'`),
              );
          })
          .orWhere((estado) => {
            estado
              .where('estado', 'flujo_activo')
              .andWhere('paso_actual', 'esperando_descripcion')
              .andWhere('procesar_despues_de', '<=', trx.fn.now());
          })
          .orWhere((estado) => {
            estado
              .where('estado', 'esperando_menu')
              .andWhere('procesar_despues_de', '<=', trx.fn.now());
          });
      })
      .whereNotExists(
        trx('solicitudes_atencion_humana as solicitud')
          .select(1)
          .whereRaw('solicitud.conversacion_id = conversaciones_whatsapp.id')
          .whereIn('solicitud.estado', ['pendiente', 'enviando', 'fallida_reintentable']),
      )
      .orderByRaw('coalesce(procesar_despues_de, procesamiento_iniciado_en) asc')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .first();

    if (!conversacion) return null;

    await trx('conversaciones_whatsapp').where({ id: conversacion.id }).update({
      estado: 'procesando',
      procesamiento_iniciado_en: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    return conversacion.id;
  });
}

async function reclamarConversacionParaSeguimiento() {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .whereIn('estado', ESTADOS_CON_SEGUIMIENTO)
      .whereNull('recordatorio_enviado_en')
      .andWhere((builder) => {
        builder
          .whereNull('recordatorio_reclamado_en')
          .orWhere(
            'recordatorio_reclamado_en',
            '<=',
            trx.raw(
              `now() - interval '${Number(env.whatsapp.workerReclamoHuerfanoSegundos)} seconds'`,
            ),
          );
      })
      .andWhere('recordatorio_programado_en', '<=', trx.fn.now())
      .orderBy('recordatorio_programado_en', 'asc')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .first();

    if (!conversacion) return null;

    await trx('conversaciones_whatsapp').where({ id: conversacion.id }).update({
      recordatorio_reclamado_en: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    return {
      id: conversacion.id,
      telefonoNormalizado: conversacion.telefono_normalizado,
      recordatorioProgramadoEn: conversacion.recordatorio_programado_en,
    };
  });
}

async function confirmarSeguimientoEnviado(conversacionId) {
  const filas = await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .whereIn('estado', ESTADOS_CON_SEGUIMIENTO)
    .whereNull('recordatorio_enviado_en')
    .update({
      recordatorio_enviado_en: db.fn.now(),
      recordatorio_reclamado_en: null,
      flujo_expira_en: db.raw(
        `now() + interval '${Number(env.whatsapp.flujoCierreAdicionalMinutos)} minutes'`,
      ),
      updated_at: db.fn.now(),
    });
  return filas > 0;
}

async function liberarSeguimiento(conversacionId) {
  await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .whereNull('recordatorio_enviado_en')
    .update({
      recordatorio_reclamado_en: db.fn.now(),
      updated_at: db.fn.now(),
    });
}

async function cerrarConversacionPorInactividad() {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .whereIn('estado', ESTADOS_CON_SEGUIMIENTO)
      .whereNotNull('recordatorio_enviado_en')
      .andWhere('flujo_expira_en', '<=', trx.fn.now())
      .orderBy('flujo_expira_en', 'asc')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .first();

    if (!conversacion) return null;

    await trx('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({ estado: 'cerrada', cerrado_en: trx.fn.now(), updated_at: trx.fn.now() });

    return conversacion.id;
  });
}

async function formarGrupoParaConversacion(conversacionId) {
  const existente = await db('grupos_whatsapp')
    .where({ conversacion_id: conversacionId, estado: 'pendiente_enrutamiento' })
    .first();
  if (existente) {
    const respuestaInteractiva = await db('mensajes_whatsapp')
      .where({ group_id: existente.group_id })
      .whereIn('tipo_mensaje', ['interactive_list_reply', 'interactive_button_reply'])
      .first('id');
    return {
      groupId: existente.group_id,
      reutilizado: true,
      texto_consolidado: existente.texto_consolidado,
      tieneTextoProcesable: existente.texto_consolidado.length > 0,
      tieneRespuestaInteractiva: Boolean(respuestaInteractiva),
    };
  }

  const pendientes = await db('mensajes_whatsapp')
    .where({ conversacion_id: conversacionId, estado_procesamiento: 'pendiente' })
    .whereNull('group_id')
    .whereNotIn('tipo_mensaje', ['interactive_list_reply', 'interactive_button_reply'])
    .orderBy([
      { column: 'recibido_en', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);

  if (pendientes.length === 0) {
    logger.warn(
      { conversacionId },
      'Conversación vencida sin mensajes pendientes; cerrada sin formar grupo.',
    );
    await cerrarConversacion(conversacionId, new Date());
    return null;
  }

  const conTexto = pendientes.filter((m) => m.mensaje_recibido !== null);
  const soloMedia = pendientes.filter((m) => m.mensaje_recibido === null);
  const textoConsolidado = conTexto.map((m) => m.mensaje_recibido).join('\n');

  return db.transaction(async (trx) => {
    const [creado] = await trx('grupos_whatsapp')
      .insert({
        conversacion_id: conversacionId,
        texto_consolidado: textoConsolidado,
        estado: 'pendiente_enrutamiento',
        pipeline_asignado: PIPELINE_NUEVO,
      })
      .onConflict(trx.raw(`(conversacion_id) WHERE estado = 'pendiente_enrutamiento'`))
      .ignore()
      .returning('*');

    const grupo =
      creado ??
      (await trx('grupos_whatsapp')
        .where({ conversacion_id: conversacionId, estado: 'pendiente_enrutamiento' })
        .first());

    await trx('mensajes_whatsapp')
      .whereIn(
        'id',
        pendientes.map((m) => m.id),
      )
      .update({ group_id: grupo.group_id });

    if (soloMedia.length > 0) {
      await trx('mensajes_whatsapp')
        .whereIn(
          'id',
          soloMedia.map((m) => m.id),
        )
        .update({ estado_procesamiento: 'no_interpretable_bot' });
    }

    return {
      groupId: grupo.group_id,
      reutilizado: !creado,
      texto_consolidado: grupo.texto_consolidado,
      tieneTextoProcesable: grupo.texto_consolidado.length > 0,
      tieneRespuestaInteractiva: pendientes.some((mensaje) =>
        ['interactive_list_reply', 'interactive_button_reply'].includes(mensaje.tipo_mensaje),
      ),
    };
  });
}

async function registrarIntentoEnrutamientoGrupo(groupId) {
  return db('grupos_whatsapp')
    .where({ group_id: groupId, pipeline_asignado: PIPELINE_NUEVO })
    .update({ intentos_enrutamiento: db.raw('intentos_enrutamiento + 1') });
}

async function incorporarFragmentosTardiosAlGrupo(trx, { conversacionId, groupId, reclamoId }) {
  const conversacion = await trx('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .forUpdate()
    .first('id', 'procesar_despues_de');
  if (!conversacion) return false;

  const pendientes = await trx('mensajes_whatsapp')
    .where({ conversacion_id: conversacionId, estado_procesamiento: 'pendiente' })
    .whereNull('group_id')
    .orderBy([
      { column: 'recibido_en', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);
  if (pendientes.length === 0) return false;

  const grupo = await trx('grupos_whatsapp')
    .where({
      group_id: groupId,
      conversacion_id: conversacionId,
      estado: 'pendiente_enrutamiento',
      clasificacion_reclamo_id: reclamoId,
    })
    .whereNull('clasificado_en')
    .forUpdate()
    .first('texto_consolidado');
  if (!grupo) return false;

  const nuevosTextos = pendientes
    .filter((mensaje) => mensaje.mensaje_recibido !== null)
    .map((mensaje) => mensaje.mensaje_recibido);
  const textoConsolidado = [grupo.texto_consolidado, ...nuevosTextos]
    .filter((texto) => texto !== '')
    .join('\n');

  await trx('grupos_whatsapp').where({ group_id: groupId }).update({
    texto_consolidado: textoConsolidado,
    clasificacion_reclamo_id: null,
    clasificacion_reclamada_en: null,
  });
  await trx('mensajes_whatsapp')
    .whereIn(
      'id',
      pendientes.map((mensaje) => mensaje.id),
    )
    .update({ group_id: groupId });

  const mediosSinTexto = pendientes
    .filter((mensaje) => mensaje.mensaje_recibido === null)
    .map((mensaje) => mensaje.id);
  if (mediosSinTexto.length > 0) {
    await trx('mensajes_whatsapp')
      .whereIn('id', mediosSinTexto)
      .update({ estado_procesamiento: 'no_interpretable_bot' });
  }

  await trx('conversaciones_whatsapp')
    .where({ id: conversacionId, estado: 'procesando' })
    .update({
      estado: 'acumulando',
      procesamiento_iniciado_en: null,
      procesar_despues_de:
        conversacion.procesar_despues_de ?? proximoProcesamiento(trx, DEBOUNCE_ACUMULANDO_MS),
      updated_at: trx.fn.now(),
    });
  return true;
}

async function registrarEnvioWhatsapp({
  plantilla,
  plantillaId,
  destinatarioTelefono,
  exitoso,
  errorCodigo,
  errorMensaje,
  origen,
  referenciaId,
  enviadoEn,
}) {
  await db('envios_whatsapp').insert({
    plantilla,
    plantilla_id: plantillaId ?? null,
    destinatario_telefono: destinatarioTelefono,
    exitoso,
    error_codigo: errorCodigo ?? null,
    error_mensaje: errorMensaje ?? null,
    origen,
    referencia_id: referenciaId ?? null,
    enviado_en: enviadoEn ?? db.fn.now(),
  });
}

async function registrarIntentoEnvio(
  {
    claveIdempotencia,
    tipoEnvio,
    origenFuncional,
    conversacionId,
    destinatarioTelefono,
    payloadFuncional,
    usaPlantilla,
    categoriaFacturacionMeta,
  },
  trx,
) {
  const conexion = trx ?? db;
  const [creado] = await conexion('outbox_whatsapp')
    .insert({
      clave_idempotencia: claveIdempotencia,
      tipo_envio: tipoEnvio,
      origen_funcional: origenFuncional,
      conversacion_id: conversacionId ?? null,
      destinatario_telefono: destinatarioTelefono,
      payload_funcional: payloadFuncional,
      usa_plantilla: usaPlantilla,
      categoria_facturacion_meta: categoriaFacturacionMeta ?? null,
    })
    .onConflict('clave_idempotencia')
    .ignore()
    .returning('*');
  const intent =
    creado ??
    (await conexion('outbox_whatsapp').where({ clave_idempotencia: claveIdempotencia }).first());
  return { intent, esNuevo: Boolean(creado) };
}

async function buscarIntentoPorClave(claveIdempotencia) {
  return db('outbox_whatsapp').where({ clave_idempotencia: claveIdempotencia }).first();
}

async function reclamarIntentoEnvio(claveIdempotencia) {
  return db.transaction(async (trx) => {
    const intent = await trx('outbox_whatsapp')
      .where({ clave_idempotencia: claveIdempotencia })
      .forUpdate()
      .first();
    if (!intent) return { intent: null, reclamado: false };

    if (
      ['enviado', 'cancelado', 'ventana_servicio_expirada'].includes(intent.estado) ||
      intent.wamid
    ) {
      return { intent, reclamado: false };
    }

    if (intent.estado === 'enviando') {
      const [vigente] = await trx('outbox_whatsapp')
        .where({ intent_id: intent.intent_id })
        .andWhere(
          'actualizado_en',
          '>',
          trx.raw(
            `now() - interval '${Number(env.whatsapp.workerReclamoHuerfanoSegundos)} seconds'`,
          ),
        )
        .select('intent_id');
      if (vigente) return { intent, reclamado: false };
    }

    const [reclamado] = await trx('outbox_whatsapp')
      .where({ intent_id: intent.intent_id })
      .update({
        estado: 'enviando',
        intentos: trx.raw('intentos + 1'),
        actualizado_en: trx.fn.now(),
      })
      .returning('*');
    return { intent: reclamado, reclamado: true };
  });
}

async function incrementarIntento(intentId) {
  await db('outbox_whatsapp')
    .where({ intent_id: intentId })
    .update({ intentos: db.raw('intentos + 1'), actualizado_en: db.fn.now() });
}

async function bloquearWamid(conexion, wamid) {
  // Serializa la llegada concurrente del envío y de sus estados de Meta.
  await conexion.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [wamid]);
}

async function marcarWamid(intentId, wamid) {
  if (!wamid) return;

  await db.transaction(async (trx) => {
    await bloquearWamid(trx, wamid);
    await trx('outbox_whatsapp')
      .where({ intent_id: intentId })
      .whereNull('wamid')
      .update({ wamid, actualizado_en: trx.fn.now() });

    const intent = await trx('outbox_whatsapp').where({ intent_id: intentId }).first('wamid');
    if (intent?.wamid !== wamid) return;

    const pendiente = await trx('estados_meta_whatsapp_pendientes').where({ wamid }).first();
    if (!pendiente) return;

    await trx('outbox_whatsapp').where({ intent_id: intentId }).update({
      estado_meta: pendiente.estado_meta,
      actualizado_en: trx.fn.now(),
    });
    await trx('estados_meta_whatsapp_pendientes').where({ wamid }).del();
  });
}

async function marcarResultadoEnvio(intentId, { estado, ultimoError = null }) {
  await db('outbox_whatsapp')
    .where({ intent_id: intentId })
    .update({ estado, ultimo_error: ultimoError, actualizado_en: db.fn.now() });
}

async function aplicarEstadoMeta(wamid, estadoMeta) {
  if (!wamid || !estadoMeta) return false;

  return db.transaction(async (trx) => {
    await bloquearWamid(trx, wamid);
    const filasAfectadas = await trx('outbox_whatsapp')
      .where({ wamid })
      .update({ estado_meta: estadoMeta, actualizado_en: trx.fn.now() });
    if (filasAfectadas > 0) return true;

    await trx('estados_meta_whatsapp_pendientes')
      .insert({ wamid, estado_meta: estadoMeta })
      .onConflict('wamid')
      .merge({ estado_meta: estadoMeta, actualizado_en: trx.fn.now() });

    await trx('estados_meta_whatsapp_pendientes')
      .where('recibido_en', '<', trx.raw("now() - interval '7 days'"))
      .del();
    return true;
  });
}

async function reclamarMensajeFlujoAnterior() {
  return db.transaction(async (trx) => {
    const mensaje = await trx('mensajes_whatsapp')
      .where({ pipeline_asignado: PIPELINE_ANTERIOR })
      .andWhere((builder) => {
        builder.where('estado_procesamiento', 'pendiente').orWhere((huerfano) => {
          huerfano
            .where('estado_procesamiento', 'procesando')
            .andWhere(
              'procesando_desde',
              '<=',
              trx.raw(
                `now() - interval '${Number(env.whatsapp.workerReclamoHuerfanoSegundos)} seconds'`,
              ),
            );
        });
      })
      .orderBy('recibido_en', 'asc')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .first();
    if (!mensaje) return null;
    await trx('mensajes_whatsapp').where({ id: mensaje.id }).update({
      estado_procesamiento: 'procesando',
      procesando_desde: trx.fn.now(),
    });
    return mensaje;
  });
}

async function finalizarMensajeFlujoAnterior(
  mensajeId,
  { categoria, plantillaId, tokensEntrada, tokensSalida, resultado, exitoso },
) {
  return db('mensajes_whatsapp')
    .where({
      id: mensajeId,
      pipeline_asignado: PIPELINE_ANTERIOR,
      estado_procesamiento: 'procesando',
    })
    .update({
      categoria_clasificacion: categoria,
      plantilla_id: plantillaId,
      tokens_entrada: tokensEntrada ?? 0,
      tokens_salida: tokensSalida ?? 0,
      ruta_enrutamiento: 'consulta_libre',
      resultado_decision: resultado,
      decision_en: db.fn.now(),
      estado_procesamiento: exitoso ? 'procesado' : 'error',
      procesado_en: db.fn.now(),
    });
}

async function guardarDecisionMensajeFlujoAnterior(
  mensajeId,
  { categoria, plantillaId, tokensEntrada, tokensSalida, resultado },
) {
  return db('mensajes_whatsapp')
    .where({
      id: mensajeId,
      pipeline_asignado: PIPELINE_ANTERIOR,
      estado_procesamiento: 'procesando',
    })
    .whereNull('decision_en')
    .update({
      categoria_clasificacion: categoria,
      plantilla_id: plantillaId,
      tokens_entrada: tokensEntrada ?? 0,
      tokens_salida: tokensSalida ?? 0,
      ruta_enrutamiento: 'consulta_libre',
      resultado_decision: resultado,
      decision_en: db.fn.now(),
    });
}

async function completarMensajeFlujoAnterior(mensajeId, exitoso) {
  return db('mensajes_whatsapp')
    .where({
      id: mensajeId,
      pipeline_asignado: PIPELINE_ANTERIOR,
      estado_procesamiento: 'procesando',
    })
    .update({
      estado_procesamiento: exitoso ? 'procesado' : 'error',
      procesado_en: db.fn.now(),
    });
}

async function liberarMensajeFlujoAnterior(mensajeId) {
  return db('mensajes_whatsapp')
    .where({
      id: mensajeId,
      pipeline_asignado: PIPELINE_ANTERIOR,
      estado_procesamiento: 'procesando',
    })
    .update({ estado_procesamiento: 'pendiente', procesando_desde: null });
}

async function registrarEventoMetrica({
  claveEvento,
  tipoEvento,
  pipelineAsignado = null,
  mensajeId = null,
  grupoId = null,
  conversacionId = null,
  resultado = null,
  ocurridoEn = new Date(),
}) {
  const [fila] = await db('eventos_metricas_whatsapp')
    .insert({
      clave_evento: claveEvento,
      tipo_evento: tipoEvento,
      pipeline_asignado: pipelineAsignado,
      mensaje_id: mensajeId,
      grupo_id: grupoId,
      conversacion_id: conversacionId,
      resultado,
      ocurrido_en: ocurridoEn,
    })
    .onConflict('clave_evento')
    .ignore()
    .returning('id');
  return Boolean(fila);
}

async function estaVentanaServicioVencida(conversacionId) {
  const fila = await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .first(db.raw(`(ultima_interaccion_en + interval '24 hours') < now() as vencida`));
  return Boolean(fila?.vencida);
}

async function obtenerNombresConocidosPorTelefono(telefono) {
  const ultimosDiez = String(telefono ?? '')
    .replace(/\D/g, '')
    .slice(-10);
  if (ultimosDiez.length !== 10) return [];

  const filas = await db('propietarios as p')
    .leftJoin('mascotas as m', function vincularMascotasActivas() {
      this.on('m.propietario_id', '=', 'p.id').andOnVal('m.activo', '=', true);
    })
    .whereRaw("right(regexp_replace(coalesce(p.telefono, ''), '[^0-9]', '', 'g'), 10) = ?", [
      ultimosDiez,
    ])
    .select('p.nombre', 'p.apellidos', 'm.nombre as mascota_nombre');

  return [
    ...new Set(
      filas.flatMap((fila) => [fila.nombre, fila.apellidos, fila.mascota_nombre]).filter(Boolean),
    ),
  ];
}

module.exports = {
  registrarMensajeYConversacion,
  cerrarConversacion,
  confirmarEnlaceAgendaEnviado,
  confirmarAvisoPrivacidadLaboratorioEnviado,
  finalizarConversacionTrasGrupo,
  confirmarMenuEnviado,
  confirmarGuiaMedioEnviada,
  confirmarEmergenciaSolicitada,
  obtenerClasificacionGrupo,
  reclamarClasificacionGrupo,
  liberarClasificacionGrupo,
  persistirClasificacionGrupo,
  registrarResultadoClaudeGrupo,
  persistirDecisionDeterministaGrupo,
  vincularIntentoEnvioGrupo,
  marcarGrupoProcesado,
  insertarEmergenciaConfirmada,
  finalizarExplicacionMedio,
  obtenerContextoDeConversacion,
  reclamarConversacionVencida,
  reclamarConversacionParaSeguimiento,
  cerrarConversacionPorInactividad,
  formarGrupoParaConversacion,
  registrarIntentoEnrutamientoGrupo,
  incorporarFragmentosTardiosAlGrupo,
  confirmarSeguimientoEnviado,
  liberarSeguimiento,
  registrarEnvioWhatsapp,
  registrarIntentoEnvio,
  buscarIntentoPorClave,
  reclamarIntentoEnvio,
  incrementarIntento,
  marcarWamid,
  marcarResultadoEnvio,
  aplicarEstadoMeta,
  estaVentanaServicioVencida,
  reclamarMensajeFlujoAnterior,
  finalizarMensajeFlujoAnterior,
  guardarDecisionMensajeFlujoAnterior,
  completarMensajeFlujoAnterior,
  liberarMensajeFlujoAnterior,
  registrarEventoMetrica,
  obtenerNombresConocidosPorTelefono,
  PIPELINE_NUEVO,
  PIPELINE_ANTERIOR,
};
