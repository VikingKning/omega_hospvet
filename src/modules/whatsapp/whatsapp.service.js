// Procesa un mensaje entrante de WhatsApp. US WA 001 dividió el flujo en 2
// pasos — registrarEventoEntrante() solo persiste (INSERT idempotente,
// llamada por whatsapp.controller.js#recibir) y un segundo paso clasifica
// + responde. Ese segundo paso, desde US WA 009, opera sobre el GRUPO
// consolidado (grupos_whatsapp.texto_consolidado, US WA 003), nunca sobre
// un mensaje individual — clasificarYResponderGrupo() es la única puerta
// de entrada a claude.clasificarMensaje en todo el sistema (ver su propio
// comentario). Antes de esa historia existía un camino paralelo por
// MENSAJE individual (procesarMensajePendiente) que nunca llegó a
// conectarse con la agrupación introducida por US WA 003 — se retiró por
// completo (junto con whatsappMensajesPendientesJob.js) en vez de
// mantener 2 esquemas de clasificación divergentes.
//
// La clasificación en sí sigue en UNA SOLA llamada (rediseño explícito del
// usuario, 2026-09-12; ver src/config/claude.js#clasificarMensaje para el
// porqué completo): el mensaje se compara, en el mismo prompt, contra
// TODOS los slugs de plantillas_whatsapp reales y activas Y los 4 slugs
// predeterminados del sistema (uno por categoría genérica) al mismo
// tiempo — nunca en 2 pasos separados, y Claude nunca decide ni ve
// es_emergencia (US WA 009, consideración técnica).
//
// Motivo del rediseño a una sola llamada (2 intentos previos, ambos
// insuficientes):
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
const claude = require('../../config/claude');
const { randomUUID } = require('node:crypto');
const db = require('../../config/database');
const env = require('../../config/env');
const logger = require('../../config/logger');
const whatsappAgenda = require('../../config/whatsappAgenda');
const { normalizarFormatoWhatsapp } = require('../../../public/js/whatsapp-format');
const plantillasRepository = require('../plantillas_whatsapp/plantillas_whatsapp.repository');
const repository = require('./whatsapp.repository');
const outbox = require('./whatsapp.outbox');
const menu = require('./whatsapp.menu');
const { RUTAS_ENRUTAMIENTO, seleccionarRutaGrupo } = require('./whatsapp.router');
const laboratorioConsulta = require('./whatsapp.laboratorioConsulta');
const laboratorioService = require('../laboratorio/laboratorio.service');
const atencionHumanaService = require('./whatsapp.atencionHumana.service');
const emergenciasAlertasService = require('./whatsapp.emergenciasAlertas.service');

const TELEFONO_CLINICA = '7711634578';

// Slugs fijos de las 4 plantillas predeterminadas del sistema (migración
// 20260903000002). US WA 009 cambió CÓMO se llega a ellas: ya no hay una
// indirección categoría->slug decidida por este archivo tras la respuesta
// de Claude — Claude ahora nombra el slug DIRECTAMENTE (ver
// SLUG_POR_CATEGORIA_GENERICA/config/claude.js), y el backend solo resuelve
// ese slug contra plantillas_whatsapp (AC11/AC12), sin ninguna rama
// especial para "una de las 4 default" vs. "una del catálogo real".
const SLUG_EMERGENCIA = 'emergencia-medica';
const SLUG_AGENDAR_CITA = 'agendar-cita-default';
const SLUG_RESULTADOS_LABORATORIO = 'resultados-laboratorio-default';
const SLUG_SIN_COINCIDENCIA = 'sin-coincidencia-default';

// US WA 009 (consideración técnica: "Claude deberá devolver únicamente el
// slug esperado"): las 4 categorías genéricas de claude.js#CATEGORIAS ahora
// se le presentan a Claude POR SU SLUG — 'duda_medica' nunca tuvo una
// plantilla predeterminada propia, así que cae al mismo respaldo
// sin-coincidencia-default que "sin encaje" (mismo comportamiento de
// siempre, ver resolverPlantillaPorSlug).
const SLUG_POR_CATEGORIA_GENERICA = {
  emergencia: SLUG_EMERGENCIA,
  agendar_cita: SLUG_AGENDAR_CITA,
  resultados_laboratorio: SLUG_RESULTADOS_LABORATORIO,
  duda_medica: SLUG_SIN_COINCIDENCIA,
};
const CATEGORIA_POR_SLUG_GENERICO = Object.fromEntries(
  Object.entries(SLUG_POR_CATEGORIA_GENERICA).map(([categoria, slug]) => [slug, categoria]),
);

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

// US WA 009 (AC11/AC12/AC18/AC19): resuelve CUALQUIER slug que Claude haya
// devuelto (uno del catálogo real O uno de los 4 predeterminados del
// sistema, sin distinción — plantillas_whatsapp.slug es único para ambos)
// contra una plantilla ACTIVA — nunca infiere es_emergencia de nada más
// que la columna real de esa plantilla (consideración técnica). `null`
// cubre tanto "Claude no encajó ninguna etiqueta" como "el slug no
// corresponde a ninguna plantilla activa/utilizable" (AC18) — ambos casos
// reciben el mismo tratamiento de parte del llamador.
async function resolverPlantillaPorSlug(slug) {
  if (!slug) return null;
  const plantilla = await plantillasRepository.findBySlug(slug);
  if (!plantilla || !plantilla.activo) return null;
  return plantilla;
}

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
  // WA010: la ruta determinista se convierte en una solicitud del mecanismo
  // único WA017 antes de confirmar el webhook. La clave por wamid permite
  // que una reentrega repare de forma segura una interrupción intermedia.
  if (resultado.rutaResuelta === 'recepcion') {
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: resultado.conversacionId,
      origen: 'recepcion',
      prioridad: 'normal',
      origenAlerta: 'menu_recepcion',
      claveIdempotencia: `recepcion:mensaje:${evento.whatsappMessageId}`,
      referenciasFuncionales: {
        groupId: resultado.groupId ?? null,
        mensajeOrigenId: resultado.id,
        whatsappMessageId: evento.whatsappMessageId,
      },
      destinatarioTelefono: telefonoNormalizado,
    });
  }
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

// US WA 011 AC27: para una ruta determinista basada en un grupo, la
// auditoría y la intención de envío nacen en una sola transacción ANTES
// de llamar a Meta. Un reintento obtiene el mismo intent por su clave.
async function registrarDecisionDeterministaEIntento({
  groupId,
  rutaEnrutamiento,
  intencionResuelta,
  resultadoDecision,
  respuestaDefinitiva,
  datosIntento,
}) {
  return db.transaction(async (trx) => {
    await repository.persistirDecisionDeterministaGrupo(trx, groupId, {
      rutaEnrutamiento,
      intencionResuelta,
      resultadoDecision,
      respuestaDefinitiva,
    });
    const { intent } = await outbox.registrarIntento(datosIntento, trx);
    await repository.vincularIntentoEnvioGrupo(trx, groupId, intent.intent_id);
    return intent;
  });
}

async function ejecutarIntentoSinPropagar(claveIdempotencia) {
  try {
    return await outbox.ejecutarIntento(claveIdempotencia);
  } catch (err) {
    return { enviado: false, error: err.message, errorCodigo: null };
  }
}

// US WA 006: las rutas de Consulta y Estética son completamente
// deterministas. Nunca pasan por Claude. Con una URL HTTPS válida se
// registra/ejecuta un único intento de outbox y la conversación solo se
// cierra después de la confirmación de Meta. Sin URL válida se reutiliza
// WA017 para avisar y transferir a Recepción en el orden correcto.
async function enviarEnlaceAgenda({ conversacionId, telefono, claveBase, ruta }) {
  const configuracion = whatsappAgenda.obtenerConfiguracionRuta(ruta);
  if (!configuracion) {
    throw new Error(`Ruta de agenda no soportada: "${ruta}".`);
  }

  if (!configuracion.url) {
    const tipoAviso =
      ruta === 'agendar_consulta' ? 'agenda_consulta_sin_enlace' : 'agenda_estetica_sin_enlace';
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId,
      origen: 'recepcion',
      prioridad: 'normal',
      claveIdempotencia: `${claveBase}:${ruta}:recepcion`,
      referenciasFuncionales: {
        ruta,
        motivo: `configuracion_${configuracion.estado}`,
      },
      destinatarioTelefono: telefono,
      tipoAviso,
    });
    return { enviado: false, transferidaARecepcion: true };
  }

  const resultado = await intentarEnvioMenu({
    claveIdempotencia: `${claveBase}:${ruta}:enlace`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'text',
      destinatarioTelefono: telefono,
      texto: whatsappAgenda.construirTextoEnlace(configuracion.tipoCita, configuracion.url),
    },
    usaPlantilla: false,
  });

  if (!resultado.enviado) {
    // El intento permanece en outbox_whatsapp como fallido, pendiente o
    // expirado según WA015. Nunca se cierra la conversación en este caso.
    logger.error(
      {
        conversacionId,
        ruta,
        errorCodigo: resultado.errorCodigo,
        error: resultado.error,
        motivo: resultado.motivo,
      },
      'No se pudo enviar el enlace de agenda; la conversación permanece abierta.',
    );
    return { ...resultado, transferidaARecepcion: false, conversacionCerrada: false };
  }

  const conversacionCerrada = await repository.confirmarEnlaceAgendaEnviado(
    conversacionId,
    new Date(),
  );
  if (!conversacionCerrada) {
    logger.warn(
      { conversacionId, ruta },
      'Meta confirmó el enlace, pero el estado actual no permite cerrar la conversación.',
    );
  }
  return { ...resultado, transferidaARecepcion: false, conversacionCerrada };
}

// US WA 004 (AC1/AC2/AC5/AC6/AC7): envía el menú interactivo (consideración
// técnica: type interactive, subtype list) y, si Meta lo rechaza, como
// máximo UN respaldo de texto plano — solo confirma la transición a
// esperando_menu si alguno de los 2 tuvo éxito. `claveBase` distingue el
// origen (grupo vs. comando inmediato sobre una conversación existente)
// para que la idempotencia del outbox nunca colisione entre ambos
// disparadores (ver comentario de cabecera de este módulo sobre los 2
// puntos de disparo).
async function enviarMenuPrincipal({
  conversacionId,
  telefono,
  claveBase,
  groupId = null,
  rutaEnrutamiento = RUTAS_ENRUTAMIENTO.COMANDO_MENU,
}) {
  const datosMenu = {
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
  };
  let resultadoMenu;
  if (groupId) {
    const intent = await registrarDecisionDeterministaEIntento({
      groupId,
      rutaEnrutamiento,
      intencionResuelta: 'mostrar_menu_principal',
      resultadoDecision: 'menu_principal',
      respuestaDefinitiva: menu.textoRespaldo(),
      datosIntento: datosMenu,
    });
    resultadoMenu = await ejecutarIntentoSinPropagar(intent.clave_idempotencia);
  } else {
    resultadoMenu = await intentarEnvioMenu(datosMenu);
  }

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
    if (groupId) {
      await repository.confirmarMenuEnviado(conversacionId, groupId);
    } else {
      await repository.confirmarMenuEnviado(conversacionId);
    }
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

// US WA 009 (AC1/AC2/AC3): envía "Por favor, descríbenos cuál es tu
// emergencia." — mismo patrón que enviarGuiaMedioNoInterpretable (texto
// plano vía outbox, sin respaldo — la consideración técnica no pide uno) y
// sin transición propia: quien confirma flujo_activo/emergencia/
// esperando_descripcion es repository.confirmarEmergenciaSolicitada, SOLO
// si el envío tuvo éxito (AC3: "no avanza... hasta que el envío sea
// confirmado").
async function enviarSolicitudEmergencia({ conversacionId, telefono, claveBase }) {
  const { intent } = await outbox.registrarIntento({
    claveIdempotencia: `${claveBase}:emergencia_solicitud`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'text',
      destinatarioTelefono: telefono,
      texto: menu.textoSolicitudEmergencia(),
    },
    usaPlantilla: false,
  });

  let resultado;
  try {
    resultado = await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    logger.error(
      { err, conversacionId },
      'Falló el envío de la solicitud de descripción de emergencia.',
    );
    resultado = { enviado: false, error: err.message, errorCodigo: null };
  }

  if (!resultado.enviado) {
    logger.error(
      { conversacionId, errorCodigo: resultado.errorCodigo, error: resultado.error },
      'No se pudo confirmar el envío de la solicitud de descripción de emergencia.',
    );
    return false;
  }

  return repository.confirmarEmergenciaSolicitada(conversacionId);
}

// US WA 009 (AC6/AC10-AC23): clasifica UN grupo consolidado (texto libre
// normal, AC10/AC17, O la descripción pedida tras MENU_EMERGENCIA, AC6 —
// ambos casos comparten exactamente esta misma función, sin distinción)
// y envía la respuesta definitiva. Reemplaza el terminal 'no_resuelto' que
// dejó pendiente US WA 004 — es la historia que finalmente conecta el
// grupo consolidado con claude.clasificarMensaje (ver el comentario de
// cabecera de este archivo).
//
// AC26 (reintento sin nueva clasificación): antes de llamar a Claude,
// siempre relee grupos_whatsapp fresco — si `clasificado_en` ya tiene
// valor (un intento anterior ya clasificó pero el ENVÍO falló, o el
// proceso se cayó a medio camino), reutiliza esos mismos valores tal
// cual, sin volver a llamar a Claude ni a crear otra solicitud de
// atención humana (AC27, junto con los ON CONFLICT DO NOTHING de la capa
// de datos).
async function clasificarYResponderGrupo({
  conversacionId,
  groupId,
  textoConsolidado,
  telefono,
  rutaEnrutamiento = RUTAS_ENRUTAMIENTO.CONSULTA_LIBRE,
}) {
  const claveEnvio = `grupo:${groupId}:respuesta`;
  let grupo = await repository.obtenerClasificacionGrupo(groupId);

  if (!grupo?.clasificado_en) {
    const reclamoId = randomUUID();
    const reclamada = await repository.reclamarClasificacionGrupo(groupId, reclamoId);
    if (!reclamada) {
      grupo = await repository.obtenerClasificacionGrupo(groupId);
      if (!grupo?.clasificado_en) return 'clasificacion_en_progreso';
    } else {
      try {
        // AC11/AC18: resuelve el slug ANTES de decidir nada — Claude nunca ve
        // ni determina es_emergencia (consideración técnica).
        const plantillasActivas = await plantillasRepository.findActivasParaClasificar();
        let slug = null;
        let tokensEntrada = 0;
        let tokensSalida = 0;
        let errorClasificador = null;
        try {
          const clasificacion = await claude.clasificarMensaje(
            textoConsolidado,
            plantillasActivas,
            SLUG_POR_CATEGORIA_GENERICA,
          );
          slug = clasificacion.etiqueta;
          tokensEntrada = clasificacion.tokensEntrada ?? 0;
          tokensSalida = clasificacion.tokensSalida ?? 0;
        } catch (err) {
          // US WA 011 AC19: un timeout, clave ausente o error de Claude se
          // convierte en una decisión persistida de respaldo. No se libera
          // el lease para reclasificar y no se registra el texto clínico.
          errorClasificador = err;
          logger.warn(
            { conversacionId, groupId, codigo: err.code ?? null, tipo: err.name },
            'El clasificador no resolvió el grupo; se usará la plantilla de respaldo.',
          );
        }

        let plantilla = await resolverPlantillaPorSlug(slug);
        const usoRespaldo = Boolean(errorClasificador) || !plantilla;
        if (!plantilla) {
          plantilla = await resolverPlantillaPorSlug(SLUG_SIN_COINCIDENCIA);
        }

        const plantillaId = plantilla?.id ?? null;
        const slugResuelto = plantilla?.slug ?? SLUG_SIN_COINCIDENCIA;
        const esEmergencia = Boolean(plantilla?.es_emergencia);
        const categoriaResuelta = usoRespaldo
          ? 'sin_coincidencia'
          : (CATEGORIA_POR_SLUG_GENERICO[slugResuelto] ?? 'duda_medica');
        const intencionResuelta = plantilla?.intencion ?? 'sin_coincidencia_default';
        let respuestaDefinitiva =
          plantilla?.texto_respuesta ||
          (esEmergencia ? menu.textoRespaldoEmergencia(TELEFONO_CLINICA) : TEXTO_RESPALDO_ABSOLUTO);
        respuestaDefinitiva = normalizarFormatoWhatsapp(respuestaDefinitiva);

        let intentoEnvioId;
        let grupoReprogramado = false;
        await db.transaction(async (trx) => {
          // Un fragmento que entró mientras Claude trabajaba invalida esta
          // clasificación parcial. Se integra al mismo grupo y no se crea ni
          // ejecuta ningún envío; el worker volverá a clasificar el texto
          // completo cuando venza la nueva ventana.
          grupoReprogramado = await repository.incorporarFragmentosTardiosAlGrupo(trx, {
            conversacionId,
            groupId,
            reclamoId,
          });
          if (grupoReprogramado) return;

          // AC23/AC27: TODO esto en una sola transacción — la clasificación
          // del grupo, la intención de envío, y (si aplica) la señal de
          // emergencia confirmada más la solicitud de atención humana.
          const persistida = await repository.persistirClasificacionGrupo(trx, groupId, {
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
            resultadoDecision: usoRespaldo ? 'plantilla_respaldo' : 'plantilla',
            etiquetaModelo: slug,
          });
          if (!persistida) {
            throw new Error(`Se perdió el lease de clasificación del grupo ${groupId}.`);
          }

          if (plantillaId) {
            await plantillasRepository.incrementarUso(plantillaId, trx);
          }

          const { intent } = await outbox.registrarIntento(
            {
              claveIdempotencia: claveEnvio,
              tipoEnvio: 'conversacional',
              origenFuncional: 'respuesta_automatica',
              conversacionId,
              destinatarioTelefono: telefono,
              payloadFuncional: {
                tipo: 'text',
                destinatarioTelefono: telefono,
                texto: respuestaDefinitiva,
              },
              usaPlantilla: false,
            },
            trx,
          );
          intentoEnvioId = intent.intent_id;
          await repository.vincularIntentoEnvioGrupo(trx, groupId, intentoEnvioId);

          if (esEmergencia) {
            // AC13/AC14: contrato para US WA 016 (emergencias_confirmadas) +
            // contrato independiente para US WA 017 (solicitudes_atencion_humana),
            // origen=emergencia/prioridad=critica, clave derivada del grupo
            // (consideración técnica). envioPrevioId=intentoEnvioId: el aviso
            // de transferencia de US WA 017 espera a que la respuesta clínica
            // ya se haya confirmado enviada (AC5 de esa historia).
            const emergenciaConfirmada = await repository.insertarEmergenciaConfirmada(trx, {
              conversacionId,
              groupId,
              plantillaId,
              slug: slugResuelto,
              respuestaDefinitiva,
              intentoEnvioId,
            });
            // WA016 consume exclusivamente la señal persistida (incluida su
            // copia histórica de es_emergencia) y delega la distribución a
            // WA018. No relee la plantilla ni vuelve a clasificar.
            await emergenciasAlertasService.registrarDesdeEmergenciaConfirmada({
              emergenciaConfirmada,
              telefonoExterno: telefono,
              trx,
            });
            await atencionHumanaService.solicitarAtencionHumana({
              conversacionId,
              origen: 'emergencia',
              prioridad: 'critica',
              claveIdempotencia: `emergencia:grupo:${groupId}`,
              referenciasFuncionales: {
                groupId,
                plantillaId,
                slug: slugResuelto,
                emergenciaConfirmadaId: emergenciaConfirmada.id,
                respuestaIntentId: intentoEnvioId,
              },
              envioPrevioId: intentoEnvioId,
              destinatarioTelefono: telefono,
              ahora: new Date(),
              registrarAlerta: false,
              trx,
            });
          }
        });

        if (grupoReprogramado) return 'grupo_reprogramado';

        grupo = {
          plantilla_id: plantillaId,
          slug_resuelto: slugResuelto,
          es_emergencia_resuelta: esEmergencia,
          respuesta_definitiva: respuestaDefinitiva,
          intento_envio_id: intentoEnvioId,
          ruta_enrutamiento: rutaEnrutamiento,
          categoria_resuelta: categoriaResuelta,
          intencion_resuelta: intencionResuelta,
          resultado_decision: usoRespaldo ? 'plantilla_respaldo' : 'plantilla',
          tokens_entrada: tokensEntrada,
          tokens_salida: tokensSalida,
        };
      } catch (err) {
        await repository.liberarClasificacionGrupo(groupId, reclamoId);
        throw err;
      }
    }
  }

  let resultadoEnvio;
  try {
    resultadoEnvio = await outbox.ejecutarIntento(claveEnvio);
  } catch (err) {
    logger.error(
      { err, conversacionId, groupId },
      'Falló el envío de la respuesta clínica del grupo.',
    );
    resultadoEnvio = { enviado: false, error: err.message, errorCodigo: null };
  }

  if (!resultadoEnvio.enviado) {
    return grupo.es_emergencia_resuelta ? 'emergencia_fallo_envio' : 'clasificado_fallo_envio';
  }

  // AC27: marca el grupo como definitivamente resuelto SOLO tras confirmar
  // el envío — mientras no se confirme, sigue 'pendiente_enrutamiento' y
  // un reintento lo reutiliza tal cual (mismo mecanismo de
  // confirmarGuiaMedioEnviada).
  await repository.marcarGrupoProcesado(groupId);
  if (!grupo.es_emergencia_resuelta) {
    // AC15/AC16: sin emergencia, el flujo normal de esa plantilla termina
    // aquí — un solo tiro, como el resto de este sistema.
    await repository.finalizarConversacionTrasGrupo(conversacionId, new Date());
    return 'clasificado_normal';
  }
  // AC25: a partir de aquí, la US WA 017 administra el mensaje de
  // transferencia, la ventana de 5 horas y la reactivación — esta
  // historia no toca el estado de la conversación.
  return 'clasificado_emergencia';
}

// US WA 014 (AC4): envía la solicitud de explicación escrita — texto
// plano vía outbox, sin respaldo (la consideración técnica no pide uno,
// a diferencia del menú de WA004) y sin transición propia: quien confirma
// la transición a flujo_activo es repository.confirmarGuiaMedioEnviada,
// solo si el envío tuvo éxito.
async function enviarGuiaMedioNoInterpretable({ conversacionId, telefono, groupId }) {
  const texto = menu.textoMedioNoInterpretable();
  const datosIntento = {
    claveIdempotencia: `grupo:${groupId}:guia_medio`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: {
      tipo: 'text',
      destinatarioTelefono: telefono,
      texto,
    },
    usaPlantilla: false,
  };
  const intent = await registrarDecisionDeterministaEIntento({
    groupId,
    rutaEnrutamiento: RUTAS_ENRUTAMIENTO.MEDIO_SIN_TEXTO,
    intencionResuelta: 'solicitar_descripcion_medio',
    resultadoDecision: 'solicitud_descripcion_medio',
    respuestaDefinitiva: texto,
    datosIntento,
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

// US WA 011: secuencia explícita y única para cualquier grupo consolidado.
// Las respuestas interactivas y la atención humana normalmente ya fueron
// consumidas en el webhook, pero seleccionarRutaGrupo conserva su lugar en
// la precedencia y evita que una anomalía termine por accidente en Claude.
async function enrutarGrupo({ conversacionId, grupo, contexto }) {
  const ruta = seleccionarRutaGrupo({ contexto, grupo });

  if (ruta === RUTAS_ENRUTAMIENTO.ATENCION_HUMANA) {
    await db.transaction(async (trx) => {
      await repository.persistirDecisionDeterministaGrupo(trx, grupo.groupId, {
        rutaEnrutamiento: ruta,
        intencionResuelta: 'mantener_silencio_atencion_humana',
        resultadoDecision: 'silencio_atencion_humana',
        respuestaDefinitiva: null,
      });
      await repository.marcarGrupoProcesado(grupo.groupId, trx);
    });
    return 'silencio_atencion_humana';
  }

  if (ruta === RUTAS_ENRUTAMIENTO.RESPUESTA_INTERACTIVA) {
    // Una respuesta interactiva nueva se procesa transaccionalmente antes
    // de agrupar. Llegar aquí implica datos heredados/inconsistentes: nunca
    // se manda el id interno a Claude ni se decide usando el título visible.
    logger.error(
      { conversacionId, groupId: grupo.groupId },
      'Una respuesta interactiva alcanzó indebidamente el router de grupos.',
    );
    return 'respuesta_interactiva_pendiente_revision';
  }

  if (ruta === RUTAS_ENRUTAMIENTO.COMANDO_MENU || ruta === RUTAS_ENRUTAMIENTO.SALUDO_PURO) {
    const enviado = await enviarMenuPrincipal({
      conversacionId,
      telefono: contexto?.telefonoNormalizado,
      claveBase: `grupo:${grupo.groupId}`,
      groupId: grupo.groupId,
      rutaEnrutamiento: ruta,
    });
    return enviado ? 'menu_enviado' : 'menu_fallido';
  }

  if (ruta === RUTAS_ENRUTAMIENTO.MEDIO_SIN_TEXTO) {
    const enviado = await enviarGuiaMedioNoInterpretable({
      conversacionId,
      telefono: contexto?.telefonoNormalizado,
      groupId: grupo.groupId,
    });
    return enviado ? 'guia_enviada' : 'guia_fallida';
  }

  if (ruta === RUTAS_ENRUTAMIENTO.FLUJO_ACTIVO) {
    if (
      contexto?.flujoActual === 'explicacion_medio' &&
      contexto?.pasoActual === 'esperando_descripcion'
    ) {
      await repository.finalizarExplicacionMedio(
        conversacionId,
        grupo.groupId,
        contexto.grupoMedioPendienteId,
      );
    } else if (
      contexto?.flujoActual !== 'emergencia' ||
      contexto?.pasoActual !== 'esperando_descripcion'
    ) {
      // Los pasos de Laboratorio se resuelven al persistir el webhook. Un
      // flujo distinto no tiene autorización para usar el clasificador
      // general hasta que su historia propietaria lo declare expresamente.
      logger.error(
        {
          conversacionId,
          groupId: grupo.groupId,
          flujo: contexto?.flujoActual,
          paso: contexto?.pasoActual,
        },
        'Flujo activo sin contrato de clasificación para el router de grupos.',
      );
      return 'flujo_activo_pendiente_revision';
    }

    return clasificarYResponderGrupo({
      conversacionId,
      groupId: grupo.groupId,
      textoConsolidado: grupo.texto_consolidado,
      telefono: contexto?.telefonoNormalizado,
      rutaEnrutamiento: ruta,
    });
  }

  return clasificarYResponderGrupo({
    conversacionId,
    groupId: grupo.groupId,
    textoConsolidado: grupo.texto_consolidado,
    telefono: contexto?.telefonoNormalizado,
    rutaEnrutamiento: RUTAS_ENRUTAMIENTO.CONSULTA_LIBRE,
  });
}

// US WA 003: coordina el reclamo (transacción 1) + la formación del grupo
// (transacción 2) de UNA conversación vencida por llamada — el job
// decide cuántas veces la llama por ciclo. Mismo patrón "job llama a
// service, service llama a repository" ya usado por
// whatsappMensajesPendientesJob.js. procesarMensajePendiente() sigue sin
// llamador — US WA 004 intercepta el caso de saludo puro/comando de menú,
// US WA 014 el de un grupo de solo medios (o la resolución de una
// explicación pendiente), y US WA 009 clasifica con Claude cualquier otro
// grupo con texto procesable (incluida la descripción pedida tras
// MENU_EMERGENCIA, ver resolviendoEmergencia más abajo).
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
  const resultado = await enrutarGrupo({ conversacionId, grupo, contexto });
  return { ...grupo, resultado };
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
  const resultado = await enviarSeguimiento({
    conversacionId: candidato.id,
    telefono: candidato.telefonoNormalizado,
    claveIdempotencia: clave,
  });
  if (resultado.enviado) {
    await repository.confirmarSeguimientoEnviado(candidato.id);
  } else {
    await repository.liberarSeguimiento(candidato.id);
  }
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

// WA013 AC2: "Continuar" reconstruye el paso activo de forma determinista,
// nunca con Claude. Los textos y botones son los mismos que ya usa cada
// flujo en su primer envío.
async function reanudarFlujoPendiente({
  conversacionId,
  telefono,
  mensajeId,
  flujoActual,
  pasoActual,
}) {
  const claveBase = `mensaje:${mensajeId}:continuar`;
  if (flujoActual === 'consulta_laboratorio') {
    const accionPorPaso = {
      confirmando_telefono: 'iniciar',
      esperando_folio: 'pedir_folio',
      esperando_telefono_folio: 'pedir_telefono_folio',
    };
    const labAccion = accionPorPaso[pasoActual];
    if (!labAccion) return null;
    return enviarPasoLaboratorio({
      conversacionId,
      telefono,
      mensajeId,
      labAccion,
      labDatos: null,
    });
  }

  let texto = null;
  if (flujoActual === 'emergencia' && pasoActual === 'esperando_descripcion') {
    texto = menu.textoSolicitudEmergencia();
  } else if (flujoActual === 'explicacion_medio' && pasoActual === 'esperando_descripcion') {
    texto = menu.textoMedioNoInterpretable();
  }
  if (!texto) return null;

  return intentarEnvioMenu({
    claveIdempotencia: `${claveBase}:${flujoActual}:${pasoActual}`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: { tipo: 'text', destinatarioTelefono: telefono, texto },
    usaPlantilla: false,
  });
}

module.exports = {
  registrarEventoEntrante,
  procesarSiguienteConversacionVencida,
  procesarSiguienteSeguimientoPendiente,
  cerrarSiguienteConversacionInactiva,
  enviarMenuPrincipal,
  enviarEnlaceAgenda,
  reenviarSeguimiento,
  reanudarFlujoPendiente,
  enviarSeleccionInvalida,
  enviarPasoLaboratorio,
  enviarSolicitudEmergencia,
  clasificarYResponderGrupo,
  enrutarGrupo,
};
