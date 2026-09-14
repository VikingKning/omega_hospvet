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

// US WA 003: antes 10_000 fijo, ahora configurable (WHATSAPP_AGRUPACION_SEGUNDOS).
const DEBOUNCE_ACUMULANDO_MS = env.whatsapp.agrupacionSegundos * 1000;

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
      procesar_despues_de: new Date(ahora.getTime() + DEBOUNCE_ACUMULANDO_MS),
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

  if (disparaMenu) {
    Object.assign(cambios, { estado: 'esperando_menu', flujo_actual: null, paso_actual: null });
  } else if (esSeleccionInteractiva && conversacion.estado === 'esperando_menu') {
    const ruta = menu.RUTA_POR_MENU_ID[contenido];
    if (ruta) {
      rutaResuelta = ruta; // AC2-AC7
      // US WA 007 (AC1): MENU_RESULTADOS_LAB no solo devuelve el id de
      // ruta — también ES la historia responsable de esa ruta (a
      // diferencia de agendar_consulta/agendar_estetica/emergencia/
      // recepcion, que WA005 deja para historias futuras), así que arranca
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
    } else {
      seguimientoAccion = 'continuar';
    }
  } else if (conversacion.estado === 'acumulando') {
    cambios.procesar_despues_de = new Date(ahora.getTime() + DEBOUNCE_ACUMULANDO_MS);
  } else if (conversacion.estado === 'esperando_menu') {
    // US WA 005 (AC10): texto libre (o cualquier mensaje no interactivo,
    // ej. una imagen) mientras se espera el menú se entrega a la
    // agrupación normal — nunca se interpreta como selección inválida.
    cambios.procesar_despues_de = new Date(ahora.getTime() + DEBOUNCE_ACUMULANDO_MS);
  }

  const estadoResultante = cambios.estado ?? conversacion.estado;
  const pasoActualResultante =
    'paso_actual' in cambios ? cambios.paso_actual : conversacion.paso_actual;

  // US WA 014 (AC5): mientras se espera la explicación escrita de un grupo
  // de medios, cualquier mensaje del tutor también arma la ventana de
  // agrupación de 10s (US WA 003) — igual que 'acumulando' — para que el
  // nuevo fragmento eventualmente forme su propio grupo. Se evalúa sobre
  // el estado/paso RESULTANTES (nunca se aplica si esComandoMenu o
  // "volver_menu" ya sacaron a la conversación de este paso arriba).
  if (estadoResultante === 'flujo_activo' && pasoActualResultante === 'esperando_descripcion') {
    cambios.procesar_despues_de = new Date(ahora.getTime() + DEBOUNCE_ACUMULANDO_MS);
  }

  if (ESTADOS_CON_SEGUIMIENTO.includes(estadoResultante)) {
    cambios.recordatorio_programado_en = new Date(
      ahora.getTime() + env.whatsapp.flujoRecordatorioMinutos * 60000,
    );
    cambios.recordatorio_enviado_en = null;
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
    estadoResultante,
  };
}

// AC1-AC5/AC17: todo dentro de una transacción — persiste el mensaje,
// busca/crea su conversación (solo si el mensaje resultó nuevo, nunca para
// una reentrega) y lo asocia.
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
  return db.transaction(async (trx) => {
    const { id, esNuevo } = await crearMensajePendiente(
      { whatsappMessageId, telefonoOrigen, tipoMensaje, contenido, mediaId, mimeType, recibidoEn },
      trx,
    );
    // AC8 (US WA 005): una reentrega del mismo whatsapp_message_id (Meta
    // reenvía una selección ya procesada) sale aquí mismo, sin volver a
    // llamar a aplicarReglasDeInteraccion — la idempotencia de US WA 001
    // ya evita reejecutar el flujo, sin código adicional.
    if (!esNuevo) return { id, esNuevo };

    const { conversacion, esNueva } = await buscarOCrearConversacionAbierta(trx, {
      phoneNumberId,
      telefonoNormalizado,
      ahora: recibidoEn,
    });
    // US WA 004 (AC2)/US WA 013 (AC2/AC3/AC5)/US WA 005 (AC2-AC9): señales
    // para que whatsapp.controller.js dispare el envío inmediato
    // correspondiente cuando el mensaje llega sobre una conversación ya
    // existente (una recién creada nunca dispara nada de esto).
    let disparaMenuInmediato = false;
    let seguimientoAccion = null;
    let estadoResultante = conversacion.estado;
    let rutaResuelta = null;
    let seleccionInvalida = false;
    let labAccion = null;
    let labDatos = null;
    if (!esNueva) {
      ({
        disparaMenu: disparaMenuInmediato,
        seguimientoAccion,
        rutaResuelta,
        seleccionInvalida,
        labAccion,
        labDatos,
        estadoResultante,
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
      estadoResultante,
    };
  });
}

// Claim atómico: el disparo inmediato del controller y el poller de
// recuperación (whatsappMensajesPendientesJob.js) pueden coincidir sobre
// la misma fila — solo el primero que gane este UPDATE la procesa, el
// segundo ve 0 filas afectadas y no hace nada más. Mismo principio de
// atomicidad a nivel de BD que ya exige AC5 para el INSERT, aplicado aquí
// al riesgo simétrico de procesar (y responder) de más.
async function reclamarPendiente(id) {
  const filasAfectadas = await db('mensajes_whatsapp')
    .where({ id, estado_procesamiento: 'pendiente' })
    .update({ estado_procesamiento: 'procesando', procesando_desde: db.fn.now() });
  return filasAfectadas > 0;
}

// US WA 002: se agrega el estado de la conversación asociada — lo
// necesita el gate de whatsapp.service.js#procesarMensajePendiente para
// decidir si debe clasificar/responder (AC7/AC12).
async function findPendientePorId(id) {
  return db('mensajes_whatsapp as m')
    .leftJoin('conversaciones_whatsapp as c', 'c.id', 'm.conversacion_id')
    .where('m.id', id)
    .first(
      'm.id',
      'm.telefono_origen',
      'm.mensaje_recibido',
      'm.conversacion_id',
      'c.estado as conversacion_estado',
    );
}

// Red de recuperación tras un reinicio de PM2 (o un disparo inmediato que
// se perdió): filas 'pendiente' con contenido procesable, MÁS filas
// 'procesando' huérfanas (el proceso se cayó después de reclamarlas pero
// antes de terminarlas — un reinicio a medio camino es tan real ahí como
// en la ventana 'pendiente'). Las 'pendiente' SIN contenido (AC8: imagen
// sin caption, audio, ubicación, etc.) se excluyen a propósito — se
// quedan pendientes indefinidamente hasta que una futura US de agrupación
// las consuma vía conversacion_id; nunca se mandan a Claude.
async function findPendientesParaProcesar({ minutosHuerfano, limite = 50 } = {}) {
  return db('mensajes_whatsapp')
    .where((builder) => {
      builder.where('estado_procesamiento', 'pendiente').whereNotNull('mensaje_recibido');
    })
    .orWhere((builder) => {
      builder
        .where('estado_procesamiento', 'procesando')
        .where(
          'procesando_desde',
          '<',
          db.raw(`now() - interval '${Number(minutosHuerfano)} minutes'`),
        );
    })
    .orderBy('id', 'asc')
    .limit(limite)
    .pluck('id');
}

async function marcarProcesado(
  id,
  {
    categoriaClasificacion,
    plantillaId,
    citaGeneradaId,
    registroLaboratorioId,
    tokensEntrada,
    tokensSalida,
  },
) {
  await db('mensajes_whatsapp')
    .where({ id })
    .update({
      categoria_clasificacion: categoriaClasificacion,
      plantilla_id: plantillaId ?? null,
      cita_generada_id: citaGeneradaId ?? null,
      registro_laboratorio_id: registroLaboratorioId ?? null,
      tokens_entrada: tokensEntrada,
      tokens_salida: tokensSalida,
      estado_procesamiento: 'procesado',
      procesado_en: db.fn.now(),
    });
}

// Solo cuando la clasificación misma truena (ej. Claude no configurado, la
// API falla) — necesita revisión manual. Distinto de una falla al ENVIAR
// la respuesta por WhatsApp, que ya se audita aparte en envios_whatsapp
// (el mensaje sí se clasificó bien, solo no llegó al tutor) y sí termina
// en 'procesado'.
async function marcarError(id) {
  await db('mensajes_whatsapp').where({ id }).update({ estado_procesamiento: 'error' });
}

// AC8/AC9/AC18: cierra la conversación SOLO si su estado actual permite la
// transición a 'cerrada' (whatsapp.estados.js) — UPDATE condicionado en
// una sola sentencia, mismo idioma atómico que reclamarPendiente. Si no
// afecta ninguna fila (ya estaba cerrada, o su estado no permite cerrar),
// se registra el error técnico y no se lanza — quien llama no debe
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
async function confirmarMenuEnviado(conversacionId) {
  const ahora = new Date();
  const filasAfectadas = await db('conversaciones_whatsapp')
    .where({ id: conversacionId })
    .whereIn('estado', ESTADOS_QUE_PERMITEN_ESPERANDO_MENU)
    .update({
      estado: 'esperando_menu',
      flujo_actual: null,
      paso_actual: null,
      // Corrección (US WA 005 AC10, mismo bug ya encontrado en
      // confirmarGuiaMedioEnviada): sin limpiar esto, un procesar_despues_de
      // VENCIDO de antes de reclamar la conversación (ej. de cuando estaba
      // 'acumulando') la vuelve a calificar de inmediato para
      // reclamarConversacionVencida (que ahora también mira esperando_menu,
      // AC10) sin que el tutor haya escrito nada nuevo.
      procesar_despues_de: null,
      recordatorio_programado_en: new Date(
        ahora.getTime() + env.whatsapp.flujoRecordatorioMinutos * 60000,
      ),
      recordatorio_enviado_en: null,
      flujo_expira_en: null,
      updated_at: ahora,
    });
  return filasAfectadas > 0;
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

// US WA 014 (AC6): relaciona el grupo de texto (la explicación escrita) con
// el grupo de medios original, finaliza el paso esperando_descripcion y
// cierra la conversación — mismo criterio ya aplicado para 'no_resuelto'
// (whatsapp.service.js#procesarSiguienteConversacionVencida): sin cerrar
// aquí, formarGrupoParaConversacion reutilizaría este mismo grupo de texto
// para siempre en cualquier mensaje futuro sobre esta conversación.
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
        estado: 'cerrada',
        cerrado_en: ahora,
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
    .first('telefono_normalizado', 'flujo_actual', 'paso_actual', 'grupo_medio_pendiente_id');
  if (!fila) return null;
  return {
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
        b.where('estado', 'acumulando').andWhere('procesar_despues_de', '<=', trx.fn.now());
      })
      .orWhere((b) => {
        b.where('estado', 'procesando').andWhere(
          'procesamiento_iniciado_en',
          '<',
          trx.raw(`now() - interval '${Number(segundosRecuperacion)} seconds'`),
        );
      })
      .orWhere((b) => {
        b.where('estado', 'flujo_activo')
          .andWhere('paso_actual', 'esperando_descripcion')
          .andWhere('procesar_despues_de', '<=', trx.fn.now());
      })
      .orWhere((b) => {
        b.where('estado', 'esperando_menu').andWhere('procesar_despues_de', '<=', trx.fn.now());
      })
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
// (whatsapp.service.js lo hace después, vía outbox) — si el proceso se cae
// justo después de reclamar pero antes de enviar, la conversación de todos
// modos se cierra a los 30 minutos totales (AC6), que es el límite duro que
// pide esta historia; no hace falta una recuperación de huérfanos aparte.
async function reclamarConversacionParaSeguimiento() {
  return db.transaction(async (trx) => {
    const conversacion = await trx('conversaciones_whatsapp')
      .whereIn('estado', ESTADOS_CON_SEGUIMIENTO)
      .whereNull('recordatorio_enviado_en')
      .andWhere('recordatorio_programado_en', '<=', trx.fn.now())
      .orderBy('recordatorio_programado_en', 'asc')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .first();

    if (!conversacion) return null;

    await trx('conversaciones_whatsapp')
      .where({ id: conversacion.id })
      .update({
        recordatorio_enviado_en: trx.fn.now(),
        flujo_expira_en: trx.raw(
          `now() + interval '${Number(env.whatsapp.flujoCierreAdicionalMinutos)} minutes'`,
        ),
        updated_at: trx.fn.now(),
      });

    return {
      id: conversacion.id,
      telefonoNormalizado: conversacion.telefono_normalizado,
      recordatorioProgramadoEn: conversacion.recordatorio_programado_en,
    };
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
    return {
      groupId: existente.group_id,
      reutilizado: true,
      texto_consolidado: existente.texto_consolidado,
      tieneTextoProcesable: existente.texto_consolidado.length > 0,
    };
  }

  const pendientes = await db('mensajes_whatsapp')
    .where({ conversacion_id: conversacionId })
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
    };
  });
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
async function registrarIntentoEnvio({
  claveIdempotencia,
  tipoEnvio,
  origenFuncional,
  conversacionId,
  destinatarioTelefono,
  payloadFuncional,
  usaPlantilla,
  categoriaFacturacionMeta,
}) {
  const [creado] = await db('outbox_whatsapp')
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
    (await db('outbox_whatsapp').where({ clave_idempotencia: claveIdempotencia }).first());
  return { intent, esNuevo: Boolean(creado) };
}

// US WA 015: siempre relee fresco de BD — el llamador nunca debe confiar
// en un objeto en memoria de un intento anterior (AC2/AC4).
async function buscarIntentoPorClave(claveIdempotencia) {
  return db('outbox_whatsapp').where({ clave_idempotencia: claveIdempotencia }).first();
}

async function incrementarIntento(intentId) {
  await db('outbox_whatsapp')
    .where({ intent_id: intentId })
    .update({ intentos: db.raw('intentos + 1'), actualizado_en: db.fn.now() });
}

// Solo si aún no había wamid — nunca pisa uno ya guardado (US WA 015 AC2).
async function marcarWamid(intentId, wamid) {
  await db('outbox_whatsapp')
    .where({ intent_id: intentId })
    .whereNull('wamid')
    .update({ wamid, actualizado_en: db.fn.now() });
}

async function marcarResultadoEnvio(intentId, { estado, ultimoError = null }) {
  await db('outbox_whatsapp')
    .where({ intent_id: intentId })
    .update({ estado, ultimo_error: ultimoError, actualizado_en: db.fn.now() });
}

// US WA 015 AC3: upsert idempotente por wamid — un webhook duplicado hace
// el mismo UPDATE dos veces, sin error ni fila extra. Si no hay ninguna
// fila con ese wamid (ej. una carrera con el propio POST, o un wamid que
// nunca pasó por este outbox), no afecta filas — el llamador decide qué
// hacer con eso (whatsapp.outbox.js solo loguea una advertencia).
async function aplicarEstadoMeta(wamid, estadoMeta) {
  const filasAfectadas = await db('outbox_whatsapp')
    .where({ wamid })
    .update({ estado_meta: estadoMeta, actualizado_en: db.fn.now() });
  return filasAfectadas > 0;
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
  reclamarPendiente,
  findPendientePorId,
  findPendientesParaProcesar,
  marcarProcesado,
  marcarError,
  cerrarConversacion,
  confirmarMenuEnviado,
  confirmarGuiaMedioEnviada,
  finalizarExplicacionMedio,
  obtenerContextoDeConversacion,
  reclamarConversacionVencida,
  reclamarConversacionParaSeguimiento,
  cerrarConversacionPorInactividad,
  formarGrupoParaConversacion,
  registrarEnvioWhatsapp,
  registrarIntentoEnvio,
  buscarIntentoPorClave,
  incrementarIntento,
  marcarWamid,
  marcarResultadoEnvio,
  aplicarEstadoMeta,
  estaVentanaServicioVencida,
};
