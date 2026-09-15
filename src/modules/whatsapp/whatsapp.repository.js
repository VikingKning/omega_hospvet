// Única capa que habla con Knex para este módulo (documento de
// Arquitectura y Buenas Prácticas, sección 4.1) — bitácora de mensajes
// entrantes de WhatsApp. US WA 001: la fila se inserta PENDIENTE en cuanto
// llega el webhook (antes de clasificar) y se completa después con un
// UPDATE — ya no se inserta una sola vez, ya procesada, al final del flujo.
const db = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { TRANSICIONES, validarTransicion, ESTADOS_CON_SEGUIMIENTO } = require('./whatsapp.estados');
const menu = require('./whatsapp.menu');
const laboratorioConsulta = require('./whatsapp.laboratorioConsulta');
const atencionHumana = require('./whatsapp.atencionHumana.repository');

// US WA 003: antes 10_000 fijo, ahora configurable (WHATSAPP_AGRUPACION_SEGUNDOS).
const DEBOUNCE_ACUMULANDO_MS = env.whatsapp.agrupacionSegundos * 1000;
// US WA 009 (AC4/AC5): ventana configurable para agrupar la descripción
// pedida tras seleccionar MENU_EMERGENCIA. Su valor operativo por defecto
// es 10s, igual al texto normal, para no cortar una descripción urgente.
const DEBOUNCE_EMERGENCIA_MS = env.whatsapp.agrupacionEmergenciaSegundos * 1000;

function proximoProcesamiento(conexion, debounceMs) {
  // La inactividad empieza cuando nuestro sistema RECIBE y confirma el
  // webhook. El timestamp de Meta viene redondeado a segundos y puede
  // llegar con retraso; usarlo aquí recortaba la ventana real.
  return conexion.raw("now() + (? * interval '1 millisecond')", [debounceMs]);
}

// Idempotencia real (AC4/AC5 de US WA 001): INSERT ... ON CONFLICT DO
// NOTHING sobre la restricción UNIQUE de whatsapp_message_id — nunca un
// SELECT previo como única protección. Si Meta reentrega el mismo wamid,
// `.returning('id')` no trae fila. `conversacion_id` NO se manda aquí:
// eso pasa después, solo si el mensaje resultó nuevo (ver
// registrarMensajeYConversacion) — así una reentrega nunca vuelve a tocar
// la conversación.
async function crearMensajePendiente(
  { whatsappMessageId, telefonoOrigen, tipoMensaje, contenido, mediaId, mimeType, recibidoEn },
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
    })
    .onConflict('whatsapp_message_id')
    .ignore()
    .returning('id');
  return row ? { id: row.id, esNuevo: true } : { id: null, esNuevo: false };
}

// AC1/AC2/AC17: busca la conversación NO cerrada de este phone_number_id +
// teléfono normalizado; si no existe, la crea. El índice único parcial
// (phone_number_id, telefono_normalizado) WHERE estado <> 'cerrada' es lo
// que hace atómica la creación ante 2 webhooks concurrentes del mismo
// número — INSERT ... ON CONFLICT contra ESE índice, nunca un SELECT
// previo como única protección (mismo criterio que crearMensajePendiente).
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

// AC5/AC6/AC7/AC11/AC12 (US WA 002): solo se llama cuando la conversación YA
// existía (una recién creada ya sale con procesar_despues_de/ultima_interaccion_en
// correctos desde el INSERT de arriba). Un comando de menú cancela el
// flujo automatizado y deja estado='esperando_menu' (ese estado ES la
// señal para que un componente futuro muestre el menú — no se crea una
// columna de "ruta" nueva); si no es un comando de menú y sigue
// 'acumulando', refresca el vencimiento de agrupación; en cualquier otro
// caso (esperando_menu/flujo_activo/atencion_humana sin comando de menú)
// solo se actualiza ultima_interaccion_en, sin tocar estado/flujo/paso —
// AC7 es explícito: "sin validar su contenido, seleccionar una ruta ni
// enviar una respuesta desde esta historia". US WA 004: regresa `disparaMenu`
// — es la señal para que whatsapp.controller.js dispare el envío inmediato
// del menú (AC2, conversación ya existente).
//
// US WA 013: además detecta la respuesta del tutor a una pregunta de
// seguimiento pendiente (recordatorio_enviado_en no nulo mientras la
// conversación sigue en esperando_menu/flujo_activo) — 'volver_menu' (AC3,
// cancela el flujo igual que un comando de menú), 'invalido' (AC5, un
// botón de respuesta rápida que no es ninguno de los 2 esperados) o
// 'continuar' (AC2 si fue el botón Continuar, o AC4 si fue texto libre —
// ambos casos conservan el flujo tal cual). Un comando de menú explícito
// (esComandoMenu) tiene prioridad sobre esto: escribir "menu" siempre
// gana, sin importar si había un seguimiento pendiente.
//
// US WA 005: procesa una selección interactiva (list_reply/button_reply)
// sobre el MENÚ vigente — se evalúa ANTES que lo de arriba: un tap real
// sobre el menú siempre se resuelve como selección de menú, nunca como
// respuesta de seguimiento, aunque ya hubiera vencido el recordatorio de
// 10 minutos de esa misma conversación. AC2-AC7: id conocido + conversación
// en esperando_menu -> `rutaResuelta` (el id de ruta, ej. 'agendar_consulta'
// — nunca se ejecuta esa ruta desde aquí, AC13). AC9: id desconocido/
// manipulado (esperando_menu) o un id de menú válido pero la conversación
// YA NO está esperando_menu ("menú vencido") -> `seleccionInvalida`. Se
// excluye atencion_humana a propósito: el bot permanece en silencio ahí,
// igual que con cualquier otro tipo de mensaje (US WA 002/014).
//
// AC10: texto libre (o cualquier tipo no interactivo) mientras se espera
// el menú NUNCA se trata como selección inválida — se arma la ventana de
// agrupación de 10s (US WA 003) igual que 'acumulando', para que
// reclamarConversacionVencida la recoja como un grupo normal.
//
// Sin importar cuál rama se tomó, si el estado RESULTANTE queda en
// esperando_menu/flujo_activo, se (re)programa el seguimiento — consideración
// técnica de US WA 013: "solamente una interacción del tutor reinicia el
// control de inactividad", nunca un job interno ni un reintento.
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
      rutaResuelta = ruta; // AC2-AC7
      // US WA 007 (AC1): MENU_RESULTADOS_LAB no solo devuelve el id de
      // ruta — también ES la historia responsable de esa ruta (a
      // diferencia de agendar_consulta/agendar_estetica y de las rutas
      // delegadas a WA009/WA010), así que arranca
      // el flujo de validación en el mismo mensaje que resuelve la ruta.
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
        // US WA 009 (AC2/AC3): a diferencia de resultados_laboratorio, la
        // transición a flujo_activo/emergencia/esperando_descripcion NO
        // ocurre aquí — solo ocurre si Meta CONFIRMA el envío de "Por
        // favor, descríbenos cuál es tu emergencia." (mismo criterio que
        // enviarMenuPrincipal/confirmarMenuEnviado, US WA 004). Esta señal
        // solo le dice al controller que dispare ese envío fire-and-forget.
        disparaSolicitudEmergencia = true;
      }
    } else {
      seleccionInvalida = true; // AC9: id desconocido o manipulado
    }
  } else if (
    esSeleccionInteractiva &&
    menu.esIdDeMenu(contenido) &&
    conversacion.estado !== 'atencion_humana'
  ) {
    seleccionInvalida = true; // AC9: id de menú válido, pero ya venció (la conversación ya no está esperando_menu)
  } else if (conversacion.flujo_actual === 'consulta_laboratorio') {
    // US WA 007: procesa TODOS los pasos de este flujo (confirmación,
    // folio, folio+teléfono) — se evalúa ANTES del seguimiento genérico de
    // US WA 013 para que un botón/texto real de este flujo nunca se
    // confunda con una respuesta de "Continuar"/"Volver al menú" aunque ya
    // hubiera vencido el recordatorio de 10 minutos de esta conversación.
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
    // US WA 005 (AC10): texto libre (o cualquier mensaje no interactivo,
    // ej. una imagen) mientras se espera el menú se entrega a la
    // agrupación normal — nunca se interpreta como selección inválida.
    cambios.procesar_despues_de = proximoProcesamiento(trx, DEBOUNCE_ACUMULANDO_MS);
  } else if (conversacion.estado === 'procesando') {
    // WA003 AC10: el grupo que ya fue reclamado es inmutable, pero el nuevo
    // fragmento debe dejar programada la siguiente ventana. Al finalizar el
    // grupo actual, cerrarConversacion/confirmarMenuEnviado detectan estos
    // mensajes sin group_id y devuelven la conversación a `acumulando`.
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

  // US WA 014 (AC5)/US WA 009 (AC4/AC5): mientras se espera una
  // explicación/descripción escrita (medio no interpretable O emergencia),
  // cualquier mensaje del tutor arma (o reinicia) la ventana de agrupación
  // — igual que 'acumulando' — para que el nuevo fragmento eventualmente
  // forme su propio grupo. Se evalúa sobre el estado/paso RESULTANTES
  // (nunca se aplica si esComandoMenu o "volver_menu" ya sacaron a la
  // conversación de este paso arriba). La ventana configurable de emergencia
  // se aplica exclusivamente a flujo_actual='emergencia' (AC4/AC5); cualquier otro flujo con
  // este mismo paso usa la ventana configurable; actualmente emergencia y
  // explicacion_medio usan 10s para permitir completar la frase.
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

// AC1-AC5/AC17 (US WA 001/002): punto de entrada — persiste el mensaje,
// busca/crea su conversación y lo asocia. US WA 017 le agrega UN chequeo
// nuevo al frente: si la conversación abierta de este teléfono YA está en
// atencion_humana, el mensaje entero se desvía a
// procesarMensajeEnAtencionHumana (AC7-AC20) en vez del camino normal
// (procesarMensajeSobreConversacion, antes vivía inline aquí mismo) — todo
// dentro de la MISMA transacción, así que el chequeo y la decisión nunca
// corren contra un estado obsoleto.
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
  };
  return db.transaction(async (trx) => {
    // La restricción UNIQUE sigue siendo la protección definitiva, pero esta
    // lectura temprana evita crear una conversación vacía cuando Meta
    // reentrega un wamid histórico cuya conversación ya estaba cerrada.
    const mensajeExistente = await trx('mensajes_whatsapp')
      .where({ whatsapp_message_id: whatsappMessageId })
      .first('id', 'conversacion_id', 'categoria_clasificacion', 'group_id');
    if (mensajeExistente) {
      return {
        id: mensajeExistente.id,
        esNuevo: false,
        conversacionId: mensajeExistente.conversacion_id,
        rutaResuelta: mensajeExistente.categoria_clasificacion,
        groupId: mensajeExistente.group_id,
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
      // WA017 AC20: desde que existe una transferencia pendiente o en
      // reintento, la conversación ya no puede producir nuevas respuestas
      // automáticas. Se conserva solamente metadata, igual que durante la
      // atención humana confirmada.
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

    return procesarMensajeSobreConversacion(trx, { conversacion, esNueva, evento });
  });
}

// US WA 017 (AC7-AC20): todo lo que ocurre cuando ya existe una conversación
// ABIERTA (no cerrada) para este teléfono ANTES de decidir el registro
// normal — se llama DESDE registrarMensajeYConversacion, dentro de la misma
// transacción, en cuanto se detecta que esa conversación está en
// atencion_humana. Si no lo está, la llamada ni ocurre: el resto del
// pipeline sigue exactamente igual que antes de esta historia.
// Forma completa y consistente del resultado — TODOS los caminos de
// procesarMensajeEnAtencionHumana la devuelven (con `id`/`conversacionId`
// propios), para que un llamador que destructura
// rutaResuelta/seleccionInvalida/labAccion/etc. (igual que ya hace con el
// resultado de procesarMensajeSobreConversacion) nunca reciba `undefined`
// en vez de su valor "nada pasó" real.
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
  // Consideración técnica: "comprobar el vencimiento ANTES de aplicar la
  // regla de silencio" (AC16) — reloj de PostgreSQL, nunca Date.now() de
  // Node (consideración técnica: "reloj de PostgreSQL como fuente de
  // verdad").
  const vencidaRow = await trx('conversaciones_whatsapp')
    .where({ id: conversacion.id })
    .first(trx.raw(`(atencion_humana_hasta <= now()) as vencida`));

  if (vencidaRow?.vencida) {
    const nueva = await atencionHumana.cerrarPorVencimientoYCrearNueva(trx, conversacion, {
      ahora: evento.recibidoEn,
      phoneNumberId: evento.phoneNumberId,
      telefonoNormalizado: evento.telefonoNormalizado,
    });
    // AC16/AC17: el mensaje que disparó esto se procesa como cualquier
    // mensaje normal, pero contra la conversación NUEVA — misma ventana de
    // agrupación de 10s de siempre (US WA 003), nunca un camino especial.
    return procesarMensajeSobreConversacion(trx, {
      conversacion: nueva,
      esNueva: true,
      evento,
    });
  }

  // AC11: se reconoce el comando EN MEMORIA (nunca se guarda el texto
  // original) — mismo esComandoMenu ya usado por US WA 004/013, que ya
  // normaliza acentos/mayúsculas (AC: "con y sin acento").
  const esComandoReactivacion =
    evento.tipoMensaje === 'text' &&
    Boolean(evento.contenido) &&
    menu.esComandoMenu(evento.contenido);

  if (esComandoReactivacion) {
    // AC13: se persiste igual que cualquier mensaje ignorado (solo
    // metadatos), pero con su propio resultado técnico
    // 'comando_reactivacion_bot' en vez de 'ignorado_atencion_humana'.
    const { id, esNuevo } = await atencionHumana.crearMensajeIgnorado(trx, {
      whatsappMessageId: evento.whatsappMessageId,
      telefonoOrigen: evento.telefonoOrigen,
      tipoMensaje: evento.tipoMensaje,
      conversacionId: conversacion.id,
      recibidoEn: evento.recibidoEn,
      estadoProcesamiento: 'comando_reactivacion_bot',
    });
    if (!esNuevo) {
      // AC10 (mismo criterio aplicado también a este caso): reentrega, nada
      // que hacer de nuevo.
      return {
        ...RESULTADO_ATENCION_HUMANA_BASE,
        id,
        esNuevo,
        conversacionId: conversacion.id,
        estadoResultante: conversacion.estado,
      };
    }

    // AC12: cierra la vieja (motivo_cierre='solicitud_tutor') y crea la
    // nueva DIRECTO en esperando_menu — `disparaMenuInmediato` reusa tal
    // cual el mecanismo de whatsapp.controller.js ya usado por un comando
    // de menú sobre una conversación existente (US WA 004 AC2).
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

  // AC7-AC9/AC14/AC20: mensaje ordinario mientras la atención humana sigue
  // vigente — silencio total, solo metadatos, atencion_humana_hasta
  // intacta (nunca se toca aquí).
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

// AC1-AC5/AC17 (US WA 001/002, sin cambios de comportamiento): persiste el
// mensaje y lo asocia a `conversacion` (ya resuelta por el llamador — esta
// función nunca decide si crear o reutilizar). Extraída de
// registrarMensajeYConversacion (antes vivía inline) para que
// procesarMensajeEnAtencionHumana (US WA 017 AC16/17) pueda reusarla tal
// cual contra la conversación NUEVA que nace de un vencimiento, sin
// duplicar esta lógica.
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
    },
    trx,
  );
  // AC8 (US WA 005)/AC9-AC10 (US WA 010): una reentrega no vuelve a
  // ejecutar las reglas de interacción. Sin embargo, si dos transacciones
  // concurrentes alcanzaron el INSERT antes de que una pudiera observar la
  // fila existente, ON CONFLICT hace que la perdedora llegue aquí con id
  // nulo. Releer la correlación ya confirmada permite que MENU_RECEPCION
  // vuelva a delegar idempotentemente a WA017 y repare incluso una caída
  // ocurrida entre el commit del mensaje y la creación de la solicitud.
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
    };
  }

  const { contenido, tituloInteractivo, tipoMensaje, recibidoEn } = evento;
  // US WA 004 (AC2)/US WA 013 (AC2/AC3/AC5)/US WA 005 (AC2-AC9): señales
  // para que whatsapp.controller.js dispare el envío inmediato
  // correspondiente cuando el mensaje llega sobre una conversación ya
  // existente (una recién creada nunca dispara nada de esto).
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
    // US WA 005 (AC3-AC7/AC13): una selección válida marca el MENSAJE
    // como procesado con la ruta resuelta como categoria_clasificacion
    // — mismo campo que usa Claude para su propia clasificación, pero
    // por un camino 100% determinista (nunca se llama a Claude, AC2). La
    // conversación en sí no se toca (AC13: "conserva la conversación
    // abierta"); una historia futura responsable de esa ruta puede
    // encontrar estos mensajes por categoria_clasificacion.
    await trx('mensajes_whatsapp').where({ id }).update({
      categoria_clasificacion: rutaResuelta,
      estado_procesamiento: 'procesado',
      procesado_en: trx.fn.now(),
    });
    if (rutaResuelta === 'recepcion') {
      // WA010 exige correlacionar la selección con conversación, mensaje y
      // grupo. Como una selección nativa no atraviesa la ventana WA003, se
      // crea un grupo técnico ya procesado de un solo mensaje; nunca queda
      // pendiente ni puede llegar al clasificador.
      const [grupo] = await trx('grupos_whatsapp')
        .insert({
          conversacion_id: conversacion.id,
          texto_consolidado: contenido,
          estado: 'procesado',
          procesado_en: trx.fn.now(),
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

  // Toda acción determinista resuelta en el webhook ya consumió este
  // mensaje. Marcarlo evita que un comando/botón inmediato quede huérfano
  // con group_id NULL y contamine una agrupación futura.
  if (
    disparaMenuInmediato ||
    (seguimientoAccion && seguimientoAccion !== 'continuar_texto') ||
    seleccionInvalida ||
    labAccion ||
    disparaSolicitudEmergencia
  ) {
    await trx('mensajes_whatsapp').where({ id }).update({
      estado_procesamiento: 'procesado',
      procesado_en: trx.fn.now(),
    });
  }

  // US WA 007 (consideración técnica: "registrar el número de intentos,
  // resultado, conversación... sin guardar teléfonos alternos
  // innecesarios en logs") — nunca se loguea el folio ni el teléfono
  // recibidos, solo el resultado determinista y el contador.
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
  };
}

// AC8/AC9/AC18: cierra la conversación SOLO si su estado actual permite la
// transición a 'cerrada' (whatsapp.estados.js) — UPDATE condicionado en
// una sola sentencia. Si no afecta ninguna fila (ya estaba cerrada, o su
// estado no permite cerrar), se registra el error técnico y no se lanza —
// quien llama no debe
// reintentar el envío ni duplicar nada por esto.
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

// US WA 006: confirma el efecto local del enlace después de que Meta ya
// aceptó el envío. Es idempotente porque una reentrega puede encontrar el
// mismo intento ya enviado: en ese caso una conversación ya cerrada cuenta
// como confirmada y no genera un error técnico falso.
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

// Final de un grupo ya enviado: si entró otro fragmento mientras el worker
// procesaba, conserva la misma conversación y la devuelve a acumulación;
// de lo contrario aplica el cierre terminal normal.
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

// US WA 004 (AC5/AC7): confirma la transición a esperando_menu solo si el
// envío del menú (interactivo o su respaldo de texto) tuvo éxito, y solo si
// el estado actual todavía lo permite — mismo idioma atómico que
// cerrarConversacion. Si no afecta ninguna fila, no se considera un error:
// el llamador (whatsapp.service.js) decide qué hacer.
const ESTADOS_QUE_PERMITEN_ESPERANDO_MENU = Object.keys(TRANSICIONES).filter((estado) =>
  validarTransicion(estado, 'esperando_menu'),
);

// US WA 013: al entrar a esperando_menu (o reafirmarlo) también se
// (re)programa el seguimiento — este es hoy el ÚNICO punto real de entrada
// a un estado de ESTADOS_CON_SEGUIMIENTO fuera del flujo de mensajes
// entrantes (lo dispara el worker de agrupación, no un webhook), así que
// aplicarReglasDeInteraccion nunca lo cubre.
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

// US WA 014 (AC4): confirma la transición a flujo_activo/explicacion_medio/
// esperando_descripcion solo si el envío de la guía tuvo éxito y el estado
// actual todavía lo permite — mismo idioma atómico que confirmarMenuEnviado.
// También marca el grupo de medios como 'procesado' (AC4: "marca el grupo
// como procesado") y arma el seguimiento de US WA 013 (flujo_activo ya es
// un ESTADOS_CON_SEGUIMIENTO). Reutilizable: si más medios sin texto llegan
// mientras se espera la explicación, se vuelve a llamar con el groupId
// nuevo, moviendo el puntero grupo_medio_pendiente_id hacia adelante.
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
        // Corrección (encontrada probando): sin limpiar esto, la conversación
        // conserva el procesar_despues_de VENCIDO de antes de reclamarla —
        // como reclamarConversacionVencida ahora también mira
        // flujo_activo+esperando_descripcion con procesar_despues_de vencido
        // (US WA 014 AC5), esa columna sin limpiar volvería a calificar de
        // inmediato para la SIGUIENTE ronda, sin que el tutor haya escrito
        // nada nuevo. Solo aplicarReglasDeInteraccion la vuelve a fijar,
        // cuando de verdad llega un mensaje nuevo.
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

// US WA 009 (AC2/AC3): confirma la transición a
// flujo_activo/emergencia/esperando_descripcion SOLO si el envío de "Por
// favor, descríbenos cuál es tu emergencia." tuvo éxito y el estado actual
// todavía lo permite — mismo idioma atómico que confirmarMenuEnviado/
// confirmarGuiaMedioEnviada. AC4: procesar_despues_de se deja en NULL a
// propósito — la ventana de emergencia arranca con el PRIMER fragmento de la
// descripción (aplicarReglasDeInteraccion), no en este momento.
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

// US WA 009: lee el estado de clasificación ACTUAL de un grupo — siempre
// fresco de BD (mismo criterio que buscarIntentoPorClave), nunca cacheado
// en memoria entre intentos. `clasificado_en === null` es la señal de "aún
// no se ha llamado a Claude para este grupo" (AC26: un reintento nunca
// debe volver a llamarlo si ya tiene valor).
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

// US WA 009 (AC13/AC22/AC23): persiste, en la transacción del llamador, el
// resultado de clasificar el grupo UNA sola vez — guardado condicionado a
// que todavía no se haya clasificado (WHERE clasificado_en IS NULL), mismo
// idioma atómico que el resto de este archivo. `es_emergencia_resuelta` es
// la copia INMUTABLE exigida por AC22: nunca se vuelve a leer
// plantillas_whatsapp.es_emergencia para esta fila después de este UPDATE.
async function persistirClasificacionGrupo(
  trx,
  groupId,
  {
    plantillaId,
    slugResuelto,
    esEmergencia,
    respuestaDefinitiva,
    tokensEntrada,
    tokensSalida,
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
      tokens_entrada: tokensEntrada ?? 0,
      tokens_salida: tokensSalida ?? 0,
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

// US WA 011: las rutas que no usan Claude también dejan una decisión
// completa a nivel de grupo, con consumo cero. Se ejecuta en la misma
// transacción que registra el outbox para persistir antes de llamar a Meta.
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
      enrutado_en: trx.fn.now(),
    })
    .returning('*');
  if (actualizado) return actualizado;
  return trx('grupos_whatsapp').where({ group_id: groupId }).first();
}

// US WA 009: liga el grupo con "la referencia a la intención de envío"
// (consideración técnica) — separado de persistirClasificacionGrupo porque
// el intent_id solo existe DESPUÉS de registrar el intento de outbox (que a
// su vez necesita el texto ya resuelto). Sin el guard WHERE, un reintento
// que reutiliza el MISMO intento (outbox ya idempotente por su propia
// clave) simplemente reafirmaría el mismo valor — inofensivo, pero el
// guard documenta la intención de "solo la primera vez" igual que el resto
// de este archivo.
async function vincularIntentoEnvioGrupo(trx, groupId, intentoEnvioId) {
  await trx('grupos_whatsapp')
    .where({ group_id: groupId })
    .whereNull('intento_envio_id')
    .update({ intento_envio_id: intentoEnvioId });
}

// US WA 009 (AC27): marca el grupo como definitivamente resuelto SOLO
// después de que el envío de la respuesta clínica se confirmó — mientras
// no se confirme, el grupo permanece 'pendiente_enrutamiento' y
// formarGrupoParaConversacion lo reutiliza tal cual ante un reintento (AC5
// de US WA 003, mismo mecanismo ya usado por confirmarGuiaMedioEnviada).
async function marcarGrupoProcesado(groupId, trx) {
  const conexion = trx ?? db;
  await conexion('grupos_whatsapp')
    .where({ group_id: groupId })
    .update({ estado: 'procesado', procesado_en: conexion.fn.now() });
  await conexion('mensajes_whatsapp')
    .where({ group_id: groupId, estado_procesamiento: 'pendiente' })
    .update({ estado_procesamiento: 'procesado', procesado_en: conexion.fn.now() });
}

// US WA 009 (AC13/AC22/AC24/AC27): INSERT ... ON CONFLICT DO NOTHING sobre
// el UNIQUE(group_id) — mismo idioma de idempotencia que el resto de este
// archivo; a lo más UNA señal de emergencia confirmada por grupo, aunque 2
// intentos coincidieran.
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

// US WA 014 (AC6): relaciona el grupo de texto con el grupo de medios y
// termina el paso, pero conserva la conversación en `procesando`. El
// servicio entrega después este mismo grupo al enrutador normal; será el
// resultado real del envío quien cierre o transfiera la conversación.
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

// US WA 004/US WA 014: el envío del menú/de la guía de medio necesita el
// teléfono destino y (para AC6 de US WA 014) el flujo/paso/grupo pendientes
// de la conversación — formarGrupoParaConversacion no los trae (solo
// trabaja sobre mensajes_whatsapp/grupos_whatsapp); se resuelve aparte para
// no ensanchar esa función ya probada (US WA 003). Los 3 campos de flujo
// sobreviven intactos al reclamo de reclamarConversacionVencida (que solo
// toca estado/procesamiento_iniciado_en), así que leerlos DESPUÉS de
// reclamar sigue reflejando lo que había ANTES de esta ronda.
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

// US WA 003 — transacción 1 de 2 (ver comentario de cabecera del archivo):
// reclama UNA conversación vencida (acumulando + procesar_despues_de
// vencido, O procesando + procesamiento_iniciado_en más viejo que el
// umbral de recuperación — un worker interrumpido, AC13, O flujo_activo +
// esperando_descripcion + procesar_despues_de vencido — US WA 014 AC5: el
// tutor escribió su explicación y hay que volver a agrupar, O
// esperando_menu + procesar_despues_de vencido — US WA 005 AC10: el tutor
// ignoró el menú y escribió texto libre, se entrega a la agrupación normal)
// usando
// FOR UPDATE SKIP LOCKED, para que 2 workers concurrentes (AC11) nunca
// reclamen la misma fila: el segundo simplemente no la ve mientras la
// primera transacción la tiene bloqueada, y deja de calificar en la
// cláusula 'acumulando' en cuanto la primera comitea. Se separa de la
// formación del grupo (transacción 2) a propósito: si TODO viviera en una
// sola transacción, un crash a la mitad revertiría también el cambio de
// estado, y AC13 ("una conversación permanece en procesando debido a la
// interrupción del worker") sería imposible de observar — AC5 además lo
// redacta como 2 pasos secuenciales ("cambia su estado a procesando ANTES
// DE formar el grupo"). Devuelve el id de la conversación reclamada, o
// null si no hay nada vencido (AC6).
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

// US WA 013 (AC1, consideración técnica "hacer idempotente el seguimiento"):
// mismo patrón FOR UPDATE SKIP LOCKED que reclamarConversacionVencida — 2
// workers nunca pueden reclamar la misma conversación. A diferencia de esa
// función, aquí el "reclamo" (marcar recordatorio_enviado_en/flujo_expira_en)
// y el "envío" no viven en la misma transacción que el envío real a Meta
// (whatsapp.service.js lo hace después, vía outbox). El lease tiene caducidad:
// recupera tanto un proceso interrumpido como un fallo temporal, pero evita
// que el drain loop reintente la misma fila sin pausa.
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
      // Conserva un lease fresco como backoff. Limpiarlo aqui haria que el
      // drain loop reclamara la misma conversacion inmediatamente y
      // repitiera llamadas a Meta sin limite durante una caida.
      recordatorio_reclamado_en: db.fn.now(),
      updated_at: db.fn.now(),
    });
}

// US WA 013 (AC6/AC8): mismo patrón FOR UPDATE SKIP LOCKED — cierra UNA
// conversación cuyo seguimiento ya venció sin respuesta. El WHERE
// estado IN (...) es lo que garantiza AC8 (nunca toca una conversación en
// otro estado) sin necesidad de un chequeo aparte.
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

// US WA 003 — transacción 2 de 2: forma el grupo de UNA conversación ya
// reclamada (estado='procesando'). Si ya existe un grupo
// 'pendiente_enrutamiento' para esta conversación (AC12/AC13: un intento
// anterior interrumpido, o un reintento tras un error temporal), lo
// reutiliza sin volver a procesar nada — el índice único parcial de
// grupos_whatsapp es lo que garantiza que nunca puede haber 2. Los
// mensajes se seleccionan UNA sola vez por conversacion_id + group_id
// NULL (AC7); uno que llegue después de este SELECT (AC10) simplemente no
// entra aquí, queda pendiente para un grupo posterior. AC14 (WA003): si no
// hay NINGÚN mensaje pendiente (de cualquier tipo), no crea un grupo
// vacío — cierra la conversación como cierre controlado.
//
// US WA 014 (AC1/AC3): ya no se excluyen los medios sin texto de la
// selección — se agrupan igual que cualquier fragmento (AC1: "lo asocia a
// la conversación y espera la ventana de agrupación"). `texto_consolidado`
// (AC3: lo único que eventualmente ve Claude) se arma SOLO con el
// subconjunto que sí tiene contenido procesable — un caption de imagen o
// documento ya llega aquí como mensaje_recibido (US WA 001/AC2 de esta
// historia); un medio sin caption queda fuera de ese texto, pero SÍ queda
// asociado al grupo. `tieneTextoProcesable` es la señal que usa
// whatsapp.service.js para decidir entre el camino normal (WA004) y el de
// "solo medios, pedir explicación" (AC4).
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

  // AC8 (WA003): separador real entre fragmentos (nunca concatenación
  // cruda) para conservar el orden cronológico sin unir palabras ni
  // alterar su significado.
  const conTexto = pendientes.filter((m) => m.mensaje_recibido !== null);
  const soloMedia = pendientes.filter((m) => m.mensaje_recibido === null);
  const textoConsolidado = conTexto.map((m) => m.mensaje_recibido).join('\n');

  return db.transaction(async (trx) => {
    const [creado] = await trx('grupos_whatsapp')
      .insert({
        conversacion_id: conversacionId,
        texto_consolidado: textoConsolidado,
        estado: 'pendiente_enrutamiento',
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

    // Técnica US WA 014: marcar como no_interpretable_bot DESPUÉS de
    // formar el grupo (nunca antes, para no descartarlo mientras se
    // esperaba una posible explicación escrita).
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

// Un webhook puede haber empezado antes de vencer la ventana, pero terminar
// de persistirse mientras Claude ya clasifica el grupo. Antes de guardar o
// enviar esa clasificación, esta operación incorpora dichos fragmentos al
// mismo grupo y lo reprograma. Así nunca sale una respuesta parcial seguida
// de otra para la continuación. El lock de la conversación se comparte con
// registrarMensajeYConversacion para que la decisión tenga un corte atómico.
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
      // aplicarReglasDeInteraccion ya fijó la nueva ventana. El fallback
      // cubre filas heredadas que pudieran no tenerla.
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

// US WA 015 (AC1/AC2): INSERT ... ON CONFLICT DO NOTHING sobre
// clave_idempotencia — mismo idioma que crearMensajePendiente/
// buscarOCrearConversacionAbierta. Un reintento con la MISMA clave
// encuentra la fila ya existente en vez de duplicarla.
// `trx` opcional (US WA 009 AC23): permite componer este INSERT dentro de
// la transacción atómica de un llamador — mismo criterio ya usado por
// crearMensajePendiente(data, trx) en este mismo archivo. Omitido, usa `db`
// tal cual se comportaba antes de esta historia.
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

// US WA 015: siempre relee fresco de BD — el llamador nunca debe confiar
// en un objeto en memoria de un intento anterior (AC2/AC4).
async function buscarIntentoPorClave(claveIdempotencia) {
  return db('outbox_whatsapp').where({ clave_idempotencia: claveIdempotencia }).first();
}

// Reclama el envío mediante una transición persistente a `enviando`. Otro
// proceso que lea la misma clave no puede llamar a Meta mientras el lease
// siga vigente; un `enviando` abandonado se recupera después del umbral.
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
  // Serializa las dos direcciones de la carrera (estado->POST y
  // POST->estado) aun cuando todavia no existe una fila que bloquear.
  await conexion.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [wamid]);
}

// Solo si aún no había wamid — nunca pisa uno ya guardado (US WA 015 AC2).
// Si el webhook de estado se adelanto a la respuesta del POST, consume el
// estado temporal dentro de la misma transaccion.
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

// US WA 015 AC3: operacion idempotente por wamid. Si el estado llega antes
// que la respuesta del POST se guarda temporalmente; marcarWamid lo consume
// despues. El advisory lock impide que quede huerfano por un intercalado de
// transacciones entre esas dos operaciones.
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

    // Los wamid ajenos o heredados nunca se asociaran a este outbox. Esta
    // poda acota la tabla sin sacrificar una carrera o reinicio reciente.
    await trx('estados_meta_whatsapp_pendientes')
      .where('recibido_en', '<', trx.raw("now() - interval '7 days'"))
      .del();
    return true;
  });
}

// US WA 015 AC5: calculado en el momento de cada intento, nunca cacheado
// — conversaciones_whatsapp.ultima_interaccion_en solo se actualiza con
// mensajes entrantes (aplicarReglasDeInteraccion), así que "los reintentos
// y mensajes del bot no extienden el periodo" ya es cierto sin columnas
// nuevas.
async function estaVentanaServicioVencida(conversacionId) {
  const fila = await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .first(db.raw(`(ultima_interaccion_en + interval '24 hours') < now() as vencida`));
  return Boolean(fila?.vencida);
}

module.exports = {
  registrarMensajeYConversacion,
  cerrarConversacion,
  confirmarEnlaceAgendaEnviado,
  finalizarConversacionTrasGrupo,
  confirmarMenuEnviado,
  confirmarGuiaMedioEnviada,
  confirmarEmergenciaSolicitada,
  obtenerClasificacionGrupo,
  reclamarClasificacionGrupo,
  liberarClasificacionGrupo,
  persistirClasificacionGrupo,
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
};
