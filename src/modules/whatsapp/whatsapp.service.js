// Procesa un mensaje entrante de WhatsApp. US WA 001 (2026-09-13) dividió
// el flujo en 2 funciones — registrarEventoEntrante() solo persiste
// (INSERT idempotente, llamada por whatsapp.controller.js#recibir antes de
// clasificar) y procesarMensajePendiente() clasifica+responde en segundo
// plano (disparada sin `await` por el controller, y también por
// whatsappMensajesPendientesJob.js como red de recuperación) — antes
// ambos pasos vivían juntos en una sola función síncrona dentro del mismo
// request del webhook. La clasificación en sí sigue en UNA SOLA llamada
// (rediseño explícito del usuario, 2026-09-12; ver
// src/config/claude.js#clasificarMensaje para el porqué completo): el
// mensaje se compara, en el mismo prompt, contra TODAS las
// `plantillas_whatsapp.intencion` reales y activas Y las 4 categorías
// genéricas fijas (`categoria_clasificacion`) al mismo tiempo — nunca en
// 2 pasos separados.
//
// Motivo del rediseño (2 intentos previos, ambos insuficientes):
// 1. El diseño original (Bitácora v4/sección 1.3) decidía 1 de las 4
//    categorías fijas ANTES de mirar el catálogo real, y solo dentro de
//    'duda_medica' comparaba contra las plantillas reales — una plantilla
//    específica (ej. "Urgencia por ahogamiento") nunca tenía oportunidad
//    si el primer filtro ya había elegido 'emergencia'/'agendar_cita'.
// 2. Invertir el orden (probar el catálogo primero, categorías fijas
//    SOLO como respaldo) arregló eso, pero introdujo una regresión nueva:
//    con solo las etiquetas específicas como opciones —sin ninguna
//    genérica bien descrita con la que competir—, Claude a veces forzaba
//    la más parecida por léxico (ej. "quiero agendar una cita" → la
//    plantilla real "revisar cita agendada") en vez de reconocer que
//    ninguna encajaba de verdad.
// La causa de fondo en ambos casos era la SEPARACIÓN en llamadas
// distintas, no el texto de un prompt — por eso ajustar prompts caso por
// caso no escala (pedido explícito del usuario: "lo que pongan los
// usuarios reales debería ser bien clasificado sin tener que estar
// interviniendo en el prompt"). Una sola llamada con ambos conjuntos de
// etiquetas presentes a la vez, más una regla explícita de desempate
// ("específica gana solo si de verdad aplica"), resuelve la causa de raíz.
//
// `categoria_clasificacion` se sigue guardando con el mismo significado
// de siempre para reportes/métricas: 'duda_medica' para CUALQUIER
// plantilla real matcheada del catálogo, o la categoría fija real
// (incluyendo 'duda_medica'/'sin_coincidencia' sin plantilla predeterminada
// propia — ver SLUG_PREDETERMINADO_POR_CATEGORIA) cuando Claude elige una
// de las 4 genéricas. 'emergencia'/'agendar_cita'/'resultados_laboratorio'
// TODAVÍA NO tienen ninguna acción real propia (no hay alerta a staff, ni
// parser de fecha/hora, ni lookup de laboratorio) — responden con la
// plantilla predeterminada del sistema de esa categoría, editable pero
// inborrable (migración 20260903000002). `cita_generada_id`/
// `registro_laboratorio_id` se quedan en null a propósito hasta que esas
// 3 fases se construyan.
const claude = require('../../config/claude');
const whatsapp = require('../../config/whatsapp');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { normalizarFormatoWhatsapp } = require('../../../public/js/whatsapp-format');
const plantillasRepository = require('../plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('./whatsapp.repository');
const outbox = require('./whatsapp.outbox');
const menu = require('./whatsapp.menu');
const laboratorioConsulta = require('./whatsapp.laboratorioConsulta');
const laboratorioService = require('../laboratorio/laboratorio.service');

const TELEFONO_CLINICA = '7711634578';

// Slugs fijos de las 4 plantillas predeterminadas del sistema (migración
// 20260903000002) — a diferencia de las demás (matcheadas por Claude
// contra su `intencion`), estas 4 solo entran cuando Claude elige una
// categoría genérica en vez de una intención específica del catálogo, y
// ahí se seleccionan de forma DETERMINISTA por categoria_clasificacion,
// nunca por el LLM.
const SLUG_EMERGENCIA = 'emergencia-medica';
const SLUG_AGENDAR_CITA = 'agendar-cita-default';
const SLUG_RESULTADOS_LABORATORIO = 'resultados-laboratorio-default';
const SLUG_SIN_COINCIDENCIA = 'sin-coincidencia-default';

// Último recurso si una plantilla predeterminada no existiera o estuviera
// inactiva — no debería pasar nunca (plantillas_whatsapp.service.js las
// protege: es_predeterminada las hace inborrables y no desactivables),
// pero una respuesta de WhatsApp jamás debe salir vacía.
const TEXTO_RESPALDO_ABSOLUTO = `Gracias por tu mensaje. Contáctanos directamente al ${TELEFONO_CLINICA} y con gusto te apoyamos.`;

// El campo `from` de un mensaje entrante de un celular mexicano llega como
// 521XXXXXXXXXX (con el "1" extra tras el 52, un resabio histórico de
// WhatsApp), pero la Graph API rechaza ese mismo número como destinatario
// al RESPONDER (error 131030 "Recipient phone number not in allowed
// list") — hay que mandar 52XXXXXXXXXX, sin el "1". Confirmado en vivo:
// Graph API normaliza el "to" de vuelta a wa_id 521... en su respuesta.
function normalizarNumeroSalida(telefono) {
  return telefono.replace(/^521(\d{10})$/, '52$1');
}

async function auditarEnvio(datos) {
  try {
    await repository.registrarEnvioWhatsapp(datos);
  } catch (err) {
    logger.error({ err }, 'No se pudo registrar la auditoría del envío de WhatsApp.');
  }
}

async function enviarRespuesta(telefono, texto, { plantillaId, plantilla }) {
  const destinatarioTelefono = normalizarNumeroSalida(telefono);
  const textoNormalizado = normalizarFormatoWhatsapp(texto);
  let res;
  let data;
  try {
    res = await fetch(whatsapp.messagesUrl(), {
      method: 'POST',
      headers: whatsapp.authHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destinatarioTelefono,
        type: 'text',
        text: { body: textoNormalizado },
      }),
    });
    data = typeof res.json === 'function' ? await res.json() : {};
  } catch (err) {
    await auditarEnvio({
      plantilla,
      plantillaId,
      destinatarioTelefono,
      exitoso: false,
      errorMensaje: err.message,
      origen: 'respuesta_automatica',
    });
    throw err;
  }

  if (!res.ok) {
    const error = new Error(data.error?.message || `Meta rechazó el envío (HTTP ${res.status}).`);
    await auditarEnvio({
      plantilla,
      plantillaId,
      destinatarioTelefono,
      exitoso: false,
      errorCodigo: data.error?.code ? String(data.error.code) : null,
      errorMensaje: error.message,
      origen: 'respuesta_automatica',
    });
    throw error;
  }

  await auditarEnvio({
    plantilla,
    plantillaId,
    destinatarioTelefono,
    exitoso: true,
    origen: 'respuesta_automatica',
  });
}

// Resuelve una de las 4 plantillas predeterminadas por su slug fijo —
// cuenta como uso real (incrementarUso) igual que una plantilla normal
// matcheada del catálogo, y su id sí viaja en `plantilla_id` de
// mensajes_whatsapp.
async function resolverPlantillaPredeterminada(slug) {
  const plantilla = await plantillasRepository.findBySlug(slug);
  if (!plantilla || !plantilla.activo) {
    return { texto: TEXTO_RESPALDO_ABSOLUTO, plantillaId: null, plantillaSlug: null };
  }
  await plantillasRepository.incrementarUso(plantilla.id);
  return {
    texto: plantilla.texto_respuesta,
    plantillaId: plantilla.id,
    plantillaSlug: plantilla.slug,
  };
}

// Slug de la plantilla predeterminada del sistema para cada categoría
// genérica — 'duda_medica' y 'sin_coincidencia' a propósito NO tienen
// entrada aquí (nunca tuvieron una plantilla predeterminada propia): caen
// al mismo respaldo `sin-coincidencia-default` vía el `??` de abajo, tal
// como ya ocurría antes de este rediseño.
const SLUG_PREDETERMINADO_POR_CATEGORIA = {
  emergencia: SLUG_EMERGENCIA,
  agendar_cita: SLUG_AGENDAR_CITA,
  resultados_laboratorio: SLUG_RESULTADOS_LABORATORIO,
};

// US WA 001/WA 002: persiste el mensaje Y lo asocia a su conversación
// (creándola si hace falta) — llamado por el controller en cuanto llega el
// webhook, nunca clasifica ni envía nada dentro de esta función.
async function registrarEventoEntrante(evento) {
  const telefonoNormalizado = normalizarNumeroSalida(evento.from);
  const resultado = await repository.registrarMensajeYConversacion({
    whatsappMessageId: evento.whatsappMessageId,
    telefonoOrigen: evento.from,
    phoneNumberId: evento.phoneNumberId,
    telefonoNormalizado,
    tipoMensaje: evento.tipoMensaje,
    contenido: evento.contenido,
    mediaId: evento.mediaId,
    mimeType: evento.mimeType ?? null,
    tituloInteractivo: evento.tituloInteractivo ?? null,
    recibidoEn: new Date(Number(evento.timestamp) * 1000),
  });
  // US WA 004 (AC2): whatsapp.controller.js necesita el teléfono y el id de
  // conversación para disparar el envío inmediato del menú.
  return { ...resultado, telefonoNormalizado };
}

// US WA 004: intenta un envío de outbox y normaliza CUALQUIER fallo (Meta
// rechaza el mensaje, o la propia llamada a Meta truena) a la misma forma
// { enviado:false, error, errorCodigo } — ni AC6 ni AC7 distinguen entre
// esos 2 tipos de falla.
async function intentarEnvioMenu(datosIntento) {
  const { intent } = await outbox.registrarIntento(datosIntento);
  try {
    return await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    return { enviado: false, error: err.message, errorCodigo: null };
  }
}

// US WA 004 (AC1/AC2/AC5/AC6/AC7): envía el menú interactivo (consideración
// técnica: type interactive, subtype list) y, si Meta lo rechaza, como
// máximo UN respaldo de texto plano — solo confirma la transición a
// esperando_menu si alguno de los 2 tuvo éxito. `claveBase` distingue el
// origen (grupo vs. comando inmediato sobre una conversación existente)
// para que la idempotencia del outbox nunca colisione entre ambos
// disparadores (ver comentario de cabecera de este módulo sobre los 2
// puntos de disparo).
async function enviarMenuPrincipal({ conversacionId, telefono, claveBase }) {
  const resultadoMenu = await intentarEnvioMenu({
    claveIdempotencia: `${claveBase}:menu`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'interactive',
      destinatarioTelefono: telefono,
      interactive: menu.interactivePayload(),
    },
    usaPlantilla: false,
  });

  let enviado = resultadoMenu.enviado;

  if (!enviado) {
    // AC6: registra código + cuerpo seguro del error — solo lo que
    // outbox.ejecutarIntento ya extrajo de Meta (mensaje/código), nunca el
    // payload saliente ni el teléfono.
    logger.error(
      { conversacionId, errorCodigo: resultadoMenu.errorCodigo, error: resultadoMenu.error },
      'Meta rechazó el menú interactivo; se intentará un mensaje de respaldo.',
    );

    const resultadoRespaldo = await intentarEnvioMenu({
      claveIdempotencia: `${claveBase}:menu:respaldo`,
      tipoEnvio: 'conversacional',
      origenFuncional: 'respuesta_automatica',
      conversacionId,
      destinatarioTelefono: telefono,
      payloadFuncional: {
        tipo: 'text',
        destinatarioTelefono: telefono,
        texto: menu.textoRespaldo(),
      },
      usaPlantilla: false,
    });
    enviado = resultadoRespaldo.enviado;

    if (!enviado) {
      // AC7: no se transiciona — el intento ya quedó registrado como
      // fallido en outbox_whatsapp para diagnóstico/reintento controlado;
      // no hace falta nada adicional para "conservarlo".
      logger.error(
        {
          conversacionId,
          errorCodigo: resultadoRespaldo.errorCodigo,
          error: resultadoRespaldo.error,
        },
        'También falló el mensaje de respaldo del menú.',
      );
    }
  }

  if (enviado) {
    await repository.confirmarMenuEnviado(conversacionId);
  }
  return enviado;
}

// US WA 005 (AC9): informa que la opción ya no es válida y muestra un menú
// nuevo — 2 envíos independientes bajo la MISMA claveBase (única por
// mensaje entrante, evita colisión con cualquier otro disparador de
// enviarMenuPrincipal para esta conversación). Si el texto informativo
// falla, igual se intenta mandar el menú (lo importante es recuperar al
// tutor, no el texto explicativo) — reutiliza enviarMenuPrincipal tal
// cual, que ya maneja su propio respaldo/confirmación de estado.
async function enviarSeleccionInvalida({ conversacionId, telefono, mensajeId }) {
  const claveBase = `mensaje:${mensajeId}`;
  await intentarEnvioMenu({
    claveIdempotencia: `${claveBase}:opcion_invalida`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'text',
      destinatarioTelefono: telefono,
      texto: menu.textoOpcionInvalida(),
    },
    usaPlantilla: false,
  });
  return enviarMenuPrincipal({ conversacionId, telefono, claveBase });
}

// US WA 007: despacha el mensaje saliente correspondiente a cada paso del
// flujo de consulta de laboratorio — cada uno es un único intento de
// outbox atado al mensaje entrante que lo disparó (mismo criterio que
// enviarSeleccionInvalida/reenviarSeguimiento). AC11: ninguna de estas
// ramas construye su texto a partir de datos de identidad del tutor (el
// folio/teléfono recibidos) — solo `labAccion` y, en el caso de éxito, el
// estado ya autorizado de la orden (AC8).
async function enviarPasoLaboratorio({ conversacionId, telefono, mensajeId, labAccion, labDatos }) {
  const claveBase = `mensaje:${mensajeId}:lab`;

  if (labAccion === 'iniciar' || labAccion === 'confirmacion_ambigua') {
    return intentarEnvioMenu({
      claveIdempotencia: `${claveBase}:confirmacion`,
      tipoEnvio: 'conversacional',
      origenFuncional: 'respuesta_automatica',
      conversacionId,
      destinatarioTelefono: telefono,
      payloadFuncional: {
        tipo: 'interactive',
        destinatarioTelefono: telefono,
        interactive: laboratorioConsulta.preguntaConfirmacionPayload(),
      },
      usaPlantilla: false,
    });
  }

  // Ampliación pedida por el usuario: si la orden ya tiene archivos
  // cargados ('cargado'/'enviado'), el bot los adjunta reusando el mismo
  // mensaje de plantilla "resultados de laboratorio listos" v2 que ya usa
  // el envío proactivo desde el panel de staff (mismo texto, mismos
  // archivos) — la plantilla ya dice "te los enviamos adjuntos a este
  // mensaje", así que sustituye por completo al texto genérico de estado
  // cuando el adjunto sale bien. Si el adjunto falla (Meta lo rechaza, el
  // archivo no se puede leer, etc.), se cae al texto genérico de siempre
  // para que el tutor nunca se quede sin ninguna respuesta.
  if (labAccion === 'exito' && labDatos) {
    const { folioId, estadoOrden } = labDatos;
    if (estadoOrden === 'cargado' || estadoOrden === 'enviado') {
      const resultado = await laboratorioService.reenviarResultadosPorWhatsapp(folioId, {
        telefono: laboratorioConsulta.ultimosDiezDigitos(telefono),
        claveIdempotenciaPrefijo: `${claveBase}:exito`,
      });
      if (resultado.ok) return resultado;
      logger.warn(
        { conversacionId, mensajeId, folioId, error: resultado.error },
        'No se pudieron adjuntar los archivos de resultados de laboratorio por WhatsApp; se envía el texto de respaldo.',
      );
    }
  }

  const textosPorAccion = {
    pedir_folio: laboratorioConsulta.textoPedirFolio(),
    pedir_telefono_folio: laboratorioConsulta.textoPedirTelefonoYFolio(),
    rechazo: laboratorioConsulta.textoRechazoGenerico(),
    limite_intentos: laboratorioConsulta.textoLimiteIntentos(),
    exito: labDatos
      ? laboratorioConsulta.textoEstadoOrden(labDatos.folioId, labDatos.estadoOrden)
      : null,
  };
  const texto = textosPorAccion[labAccion];
  if (!texto) return null;

  return intentarEnvioMenu({
    claveIdempotencia: `${claveBase}:${labAccion}`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: { tipo: 'text', destinatarioTelefono: telefono, texto },
    usaPlantilla: false,
  });
}

// US WA 013 (AC1): envía la pregunta de seguimiento (Continuar/Volver al
// menú) vía outbox — sin respaldo de texto (a diferencia del menú de WA004,
// esta consideración técnica no pide uno) y sin transición de estado
// propia: la conversación ya está en esperando_menu/flujo_activo, que es
// justo lo que se está intentando conservar. Un fallo de envío no impide
// el cierre por inactividad de AC6 — ver el comentario de
// reclamarConversacionParaSeguimiento en whatsapp.repository.js.
async function enviarSeguimiento({ conversacionId, telefono, claveIdempotencia }) {
  const { intent } = await outbox.registrarIntento({
    claveIdempotencia,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'interactive',
      destinatarioTelefono: telefono,
      interactive: menu.seguimientoInteractivePayload(),
    },
    usaPlantilla: false,
  });
  try {
    return await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    logger.error({ err, conversacionId }, 'Falló el envío de la pregunta de seguimiento.');
    return { enviado: false, error: err.message, errorCodigo: null };
  }
}

// US WA 001: clasifica + responde, en segundo plano — llamado por el
// disparo fire-and-forget del controller Y por whatsappMensajesPendientesJob.js
// (recuperación tras un reinicio de PM2), así que puede coincidir con
// alguien más intentando procesar la MISMA fila; reclamarPendiente() hace
// que solo uno de los dos gane esa carrera (ver su comentario en
// whatsapp.repository.js). El bloque de clasificación/resolución de
// plantilla es EXACTAMENTE el mismo que antes vivía en
// procesarMensajeEntrante — solo cambia cómo se persiste el resultado
// (UPDATE de la fila ya existente, no un INSERT nuevo al final).
async function procesarMensajePendiente(mensajeId) {
  const reclamado = await repository.reclamarPendiente(mensajeId);
  if (!reclamado) return;

  const mensaje = await repository.findPendientePorId(mensajeId);
  if (!mensaje) return;

  // US WA 002 (AC7/AC12): si la conversación ya no está 'acumulando' (ej.
  // esperando_menu tras un comando de menú, o atencion_humana), este
  // clasificador no debe clasificar ni responder.
  if (mensaje.conversacion_id && mensaje.conversacion_estado !== 'acumulando') {
    await repository.marcarProcesado(mensajeId, {
      categoriaClasificacion: null,
      plantillaId: null,
      tokensEntrada: 0,
      tokensSalida: 0,
    });
    return;
  }

  const telefono = mensaje.telefono_origen;
  const texto = mensaje.mensaje_recibido;

  let etiqueta;
  let tokensEntrada;
  let tokensSalida;
  let respuesta;
  let plantillaId;
  let plantillaSlug;
  let categoriaGuardada;

  try {
    const plantillas = await plantillasRepository.findActivasParaClasificar();
    ({ etiqueta, tokensEntrada, tokensSalida } = await claude.clasificarMensaje(texto, plantillas));

    const plantillaDelCatalogo = plantillas.find((p) => p.intencion === etiqueta);
    if (plantillaDelCatalogo) {
      await plantillasRepository.incrementarUso(plantillaDelCatalogo.id);
      respuesta = plantillaDelCatalogo.texto_respuesta;
      plantillaId = plantillaDelCatalogo.id;
      plantillaSlug = plantillaDelCatalogo.slug;
      // Mismo valor que se guardaba antes para CUALQUIER plantilla real
      // matcheada del catálogo — no cambia el significado de esta columna
      // para reportes/métricas ya existentes.
      categoriaGuardada = 'duda_medica';
    } else {
      // Claude eligió una de las 4 categorías genéricas (o ninguna
      // etiqueta válida) en vez de una intención específica del catálogo.
      categoriaGuardada = etiqueta ?? claude.SIN_COINCIDENCIA;

      const slugPredeterminado =
        SLUG_PREDETERMINADO_POR_CATEGORIA[etiqueta] ?? SLUG_SIN_COINCIDENCIA;
      const resuelto = await resolverPlantillaPredeterminada(slugPredeterminado);
      respuesta = resuelto.texto;
      plantillaId = resuelto.plantillaId;
      plantillaSlug = resuelto.plantillaSlug;
    }
  } catch (err) {
    await repository.marcarError(mensajeId);
    throw err;
  }

  let errorEnvio;
  try {
    await enviarRespuesta(telefono, respuesta, {
      plantillaId,
      plantilla: plantillaSlug ? plantillaSlug.replace(/-/g, '_') : 'respuesta_sin_plantilla',
    });
  } catch (err) {
    errorEnvio = err;
  }

  await repository.marcarProcesado(mensajeId, {
    categoriaClasificacion: categoriaGuardada,
    plantillaId,
    tokensEntrada,
    tokensSalida,
  });

  // US WA 002 (AC8/AC9): la respuesta es el "flujo" de hoy (un solo tiro)
  // — si se envió con éxito, cierra la conversación; si falló, se queda
  // como estaba para no duplicar el cierre ni perder el contexto.
  if (!errorEnvio && mensaje.conversacion_id) {
    await repository.cerrarConversacion(mensaje.conversacion_id, new Date());
  }

  if (errorEnvio) throw errorEnvio;
}

// US WA 014 (AC4): envía la solicitud de explicación escrita — texto
// plano vía outbox, sin respaldo (la consideración técnica no pide uno,
// a diferencia del menú de WA004) y sin transición propia: quien confirma
// la transición a flujo_activo es repository.confirmarGuiaMedioEnviada,
// solo si el envío tuvo éxito.
async function enviarGuiaMedioNoInterpretable({ conversacionId, telefono, groupId }) {
  const { intent } = await outbox.registrarIntento({
    claveIdempotencia: `grupo:${groupId}:guia_medio`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'text',
      destinatarioTelefono: telefono,
      texto: menu.textoMedioNoInterpretable(),
    },
    usaPlantilla: false,
  });

  let resultado;
  try {
    resultado = await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    logger.error({ err, conversacionId }, 'Falló el envío de la guía de medio no interpretable.');
    resultado = { enviado: false, error: err.message, errorCodigo: null };
  }

  if (!resultado.enviado) {
    // Sin transición: la conversación sigue 'procesando' y la recuperación
    // de huérfanos de US WA 003 la vuelve a intentar más tarde, con la
    // MISMA clave de idempotencia (sin duplicar el envío si de verdad ya
    // había llegado a Meta).
    logger.error(
      { conversacionId, errorCodigo: resultado.errorCodigo, error: resultado.error },
      'No se pudo confirmar el envío de la guía de medio no interpretable.',
    );
    return false;
  }

  return repository.confirmarGuiaMedioEnviada(conversacionId, groupId);
}

// US WA 003: coordina el reclamo (transacción 1) + la formación del grupo
// (transacción 2) de UNA conversación vencida por llamada — el job
// decide cuántas veces la llama por ciclo. Mismo patrón "job llama a
// service, service llama a repository" ya usado por
// whatsappMensajesPendientesJob.js. procesarMensajePendiente() sigue sin
// llamador, sin tocarse, a la espera de una historia futura que conecte el
// grupo consolidado con la clasificación de Claude — US WA 004 intercepta
// el caso de saludo puro/comando de menú, y US WA 014 el de un grupo de
// solo medios (o la resolución de una explicación pendiente) — ninguno de
// los 2 debe llegar a Claude.
async function procesarSiguienteConversacionVencida() {
  const conversacionId = await repository.reclamarConversacionVencida({
    segundosRecuperacion: env.whatsapp.agrupacionReclamoHuerfanoMinutos * 60,
  });
  if (!conversacionId) return null;

  // US WA 014: se lee ANTES de formar el grupo — reclamarConversacionVencida
  // solo toca estado/procesamiento_iniciado_en, así que flujo_actual/
  // paso_actual/grupo_medio_pendiente_id todavía reflejan lo que había
  // antes de esta ronda (si la conversación venía de flujo_activo/
  // esperando_descripcion, AC6 lo necesita para relacionar los 2 grupos).
  const contexto = await repository.obtenerContextoDeConversacion(conversacionId);

  const grupo = await repository.formarGrupoParaConversacion(conversacionId);
  if (!grupo) return null; // AC14 (WA003): cerrada sin grupo, nada que evaluar.

  const resolviendoExplicacion =
    contexto?.flujoActual === 'explicacion_medio' &&
    contexto?.pasoActual === 'esperando_descripcion';

  if (resolviendoExplicacion && grupo.tieneTextoProcesable) {
    // AC6: el tutor por fin escribió su explicación — relaciona el grupo
    // de texto con el de medios original, finaliza el paso y entrega el
    // texto consolidado al enrutamiento normal (hoy, el mismo destino
    // terminal que 'no_resuelto': no existe todavía un consumidor real).
    await repository.finalizarExplicacionMedio(
      conversacionId,
      grupo.groupId,
      contexto.grupoMedioPendienteId,
    );
    return { ...grupo, resultado: 'explicacion_recibida' };
  }

  if (!grupo.tieneTextoProcesable) {
    // AC4 (grupo nuevo, solo medios) o AC1 (más medios sin texto mientras
    // ya se esperaba una explicación — confirmarGuiaMedioEnviada mueve el
    // puntero grupo_medio_pendiente_id hacia este grupo más reciente).
    const enviado = await enviarGuiaMedioNoInterpretable({
      conversacionId,
      telefono: contexto?.telefonoNormalizado,
      groupId: grupo.groupId,
    });
    return { ...grupo, resultado: enviado ? 'guia_enviada' : 'guia_fallida' };
  }

  // US WA 004 (AC1-AC4): reclamarConversacionVencida solo reclama
  // conversaciones 'acumulando'/'procesando'/'flujo_activo' — una en
  // atencion_humana nunca llega aquí, así que la condición "no está en
  // atención humana" de AC2 ya está garantizada estructuralmente.
  if (menu.esSaludoPuro(grupo.texto_consolidado) || menu.esComandoMenu(grupo.texto_consolidado)) {
    const enviado = await enviarMenuPrincipal({
      conversacionId,
      telefono: contexto?.telefonoNormalizado,
      claveBase: `grupo:${grupo.groupId}`,
    });
    return { ...grupo, resultado: enviado ? 'menu_enviado' : 'menu_fallido' };
  }

  // AC3/AC4 (WA004): esta historia no muestra el menú ni clasifica — el
  // grupo queda en pendiente_enrutamiento para que una historia futura de
  // enrutamiento lo procese. CORRECCIÓN (descubierta probando en vivo): sin
  // cerrar la conversación aquí, formarGrupoParaConversacion siempre
  // reutiliza este MISMO grupo pendiente en cualquier llamada futura para
  // esta conversación (WA003) — cualquier mensaje posterior del tutor
  // (incluido un saludo puro que normalmente sí dispararía el menú) queda
  // huérfano para siempre, sin group_id, porque nunca se vuelve a mirar.
  // Cerrar la conversación no descarta el grupo (grupos_whatsapp sigue
  // existiendo para la futura historia de enrutamiento) — solo hace que el
  // SIGUIENTE mensaje del tutor arranque una conversación nueva y limpia
  // (AC7 de US WA 013, "mensaje tras cierre -> nueva conversación").
  await repository.cerrarConversacion(conversacionId, new Date());
  return { ...grupo, resultado: 'no_resuelto' };
}

// US WA 013 (AC1): reclama UNA conversación con seguimiento vencido y le
// envía la pregunta — la clave de idempotencia incluye el momento en que se
// programó ese seguimiento (recordatorioProgramadoEn) para que un NUEVO
// ciclo de inactividad (tras responder y volver a quedar callado) tenga su
// propia clave, nunca la del ciclo anterior ya resuelto.
async function procesarSiguienteSeguimientoPendiente() {
  const candidato = await repository.reclamarConversacionParaSeguimiento();
  if (!candidato) return null;

  const clave = `conversacion:${candidato.id}:seguimiento:${new Date(candidato.recordatorioProgramadoEn).getTime()}`;
  await enviarSeguimiento({
    conversacionId: candidato.id,
    telefono: candidato.telefonoNormalizado,
    claveIdempotencia: clave,
  });
  return candidato.id;
}

// US WA 013 (AC6/AC8): cierra UNA conversación cuyo seguimiento venció sin
// respuesta — el propio repository garantiza el alcance (solo
// esperando_menu/flujo_activo).
async function cerrarSiguienteConversacionInactiva() {
  return repository.cerrarConversacionPorInactividad();
}

// US WA 013 (AC5): re-muestra la MISMA pregunta de seguimiento cuando el
// tutor responde con un botón que no es Continuar ni Volver al menú — clave
// atada al id del mensaje entrante (único por wamid), no al ciclo de
// inactividad: es un reenvío puntual, no un nuevo seguimiento programado.
async function reenviarSeguimiento({ conversacionId, telefono, mensajeId }) {
  return enviarSeguimiento({
    conversacionId,
    telefono,
    claveIdempotencia: `mensaje:${mensajeId}:seguimiento-invalido`,
  });
}

module.exports = {
  registrarEventoEntrante,
  procesarMensajePendiente,
  procesarSiguienteConversacionVencida,
  procesarSiguienteSeguimientoPendiente,
  cerrarSiguienteConversacionInactiva,
  enviarMenuPrincipal,
  reenviarSeguimiento,
  enviarSeleccionInvalida,
  enviarPasoLaboratorio,
};
