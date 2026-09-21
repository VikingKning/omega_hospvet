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
const consentimientoService = require('./whatsapp.consentimiento.service');
const emergenciasAlertasService = require('./whatsapp.emergenciasAlertas.service');

const TELEFONO_CLINICA = '7711634578';

const SLUG_EMERGENCIA = 'emergencia-medica';
const SLUG_AGENDAR_CITA = 'agendar-cita-default';
const SLUG_RESULTADOS_LABORATORIO = 'resultados-laboratorio-default';
const SLUG_SIN_COINCIDENCIA = 'sin-coincidencia-default';

const SLUG_POR_CATEGORIA_GENERICA = {
  emergencia: SLUG_EMERGENCIA,
  agendar_cita: SLUG_AGENDAR_CITA,
  resultados_laboratorio: SLUG_RESULTADOS_LABORATORIO,
  duda_medica: SLUG_SIN_COINCIDENCIA,
};
const CATEGORIA_POR_SLUG_GENERICO = Object.fromEntries(
  Object.entries(SLUG_POR_CATEGORIA_GENERICA).map(([categoria, slug]) => [slug, categoria]),
);

const TEXTO_RESPALDO_ABSOLUTO = `Gracias por tu mensaje. Contáctanos directamente al ${TELEFONO_CLINICA} y con gusto te apoyamos.`;

function normalizarNumeroSalida(telefono) {
  // Meta reporta celulares mexicanos como 521…, pero exige 52… al enviar.
  return telefono.replace(/^521(\d{10})$/, '52$1');
}

async function resolverPlantillaPorSlug(slug) {
  if (!slug) return null;
  const plantilla = await plantillasRepository.findBySlug(slug);
  if (!plantilla || !plantilla.activo) return null;
  return plantilla;
}

async function registrarEventoEntrante(evento) {
  const telefonoNormalizado = normalizarNumeroSalida(evento.from);
  const pipelineAsignado = env.whatsapp.conversationalRouterEnabled
    ? repository.PIPELINE_NUEVO
    : repository.PIPELINE_ANTERIOR;
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
    pipelineAsignado,
  });
  const pipelinePersistido = resultado.pipelineAsignado ?? pipelineAsignado;
  if (pipelinePersistido === repository.PIPELINE_NUEVO && resultado.rutaResuelta === 'recepcion') {
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
  if (
    pipelinePersistido === repository.PIPELINE_NUEVO &&
    resultado.rutaResuelta === 'ver_aviso_privacidad'
  ) {
    const enviado = await consentimientoService.enviarAvisoInformativo({
      conversacionId: resultado.conversacionId,
      telefono: telefonoNormalizado,
      claveIdempotenciaBase: `mensaje:${evento.whatsappMessageId}`,
    });
    if (!enviado.enviado) {
      await intentarEnvioMenu({
        claveIdempotencia: `mensaje:${evento.whatsappMessageId}:lfpdppp_aviso_info:respaldo`,
        tipoEnvio: 'conversacional',
        origenFuncional: 'respuesta_automatica',
        conversacionId: resultado.conversacionId,
        destinatarioTelefono: telefonoNormalizado,
        payloadFuncional: {
          tipo: 'text',
          destinatarioTelefono: telefonoNormalizado,
          texto: menu.textoAvisoPrivacidadNoDisponible(TELEFONO_CLINICA),
        },
        usaPlantilla: false,
      });
    }
  }
  if (pipelinePersistido === repository.PIPELINE_NUEVO && resultado.necesitaEnviarAvisoLfpdppp) {
    const enviado = await consentimientoService.enviarAvisoPrivacidad({
      conversacionId: resultado.conversacionId,
      telefono: telefonoNormalizado,
      claveIdempotenciaBase: `mensaje:${evento.whatsappMessageId}`,
    });
    if (!enviado.enviado && enviado.motivo !== 'sin_configurar') {
      await intentarEnvioMenu({
        claveIdempotencia: `mensaje:${evento.whatsappMessageId}:lfpdppp_aviso:respaldo`,
        tipoEnvio: 'conversacional',
        origenFuncional: 'respuesta_automatica',
        conversacionId: resultado.conversacionId,
        destinatarioTelefono: telefonoNormalizado,
        payloadFuncional: {
          tipo: 'text',
          destinatarioTelefono: telefonoNormalizado,
          texto: menu.textoAvisoPrivacidadEnvioFallido(TELEFONO_CLINICA),
        },
        usaPlantilla: false,
      });
    }
  }
  if (
    pipelinePersistido === repository.PIPELINE_NUEVO &&
    resultado.disparaAtencionHumanaConsentimiento
  ) {
    await atencionHumanaService.solicitarAtencionHumana({
      conversacionId: resultado.conversacionId,
      origen: 'consentimiento',
      prioridad: 'normal',
      origenAlerta: 'consentimiento',
      claveIdempotencia: `consentimiento:mensaje:${evento.whatsappMessageId}`,
      referenciasFuncionales: {
        groupId: null,
        mensajeOrigenId: resultado.id,
        whatsappMessageId: evento.whatsappMessageId,
      },
      destinatarioTelefono: telefonoNormalizado,
    });
  }
  logger.info(
    {
      whatsappMessageId: evento.whatsappMessageId,
      conversacionId: resultado.conversacionId ?? null,
      pipeline: pipelinePersistido,
      resultado: resultado.esNuevo ? 'asignado' : 'duplicado',
    },
    'Mensaje de WhatsApp registrado con pipeline persistido.',
  );
  return { ...resultado, pipelineAsignado: pipelinePersistido, telefonoNormalizado };
}

async function procesarSiguienteMensajeFlujoAnterior() {
  const mensaje = await repository.reclamarMensajeFlujoAnterior();
  if (!mensaje) return null;

  const claveEnvio = `legacy:mensaje:${mensaje.id}:respuesta`;
  try {
    if (mensaje.decision_en) {
      const intento = await repository.buscarIntentoPorClave(claveEnvio);
      if (!intento) {
        await repository.completarMensajeFlujoAnterior(mensaje.id, false);
        return mensaje.id;
      }
      const resultado = await outbox.ejecutarIntento(claveEnvio);
      if (resultado.enviado) await repository.completarMensajeFlujoAnterior(mensaje.id, true);
      else await repository.liberarMensajeFlujoAnterior(mensaje.id);
      return mensaje.id;
    }

    if (mensaje.tipo_mensaje !== 'text' || !mensaje.mensaje_recibido) {
      await repository.finalizarMensajeFlujoAnterior(mensaje.id, {
        categoria: 'no_soportado',
        plantillaId: null,
        tokensEntrada: 0,
        tokensSalida: 0,
        resultado: 'ignorado_tipo_no_soportado',
        exitoso: true,
      });
      return mensaje.id;
    }

    const plantillas = await plantillasRepository.findActivasParaClasificar();
    let slug = null;
    let tokensEntrada = 0;
    let tokensSalida = 0;
    let resultadoClaude = 'no_configurado';
    let llamadaReal = false;
    try {
      const nombresConocidos = await repository.obtenerNombresConocidosPorTelefono(
        mensaje.telefono_origen,
      );
      const clasificacion = await claude.clasificarMensaje(
        mensaje.mensaje_recibido,
        plantillas,
        SLUG_POR_CATEGORIA_GENERICA,
        { nombresConocidos },
      );
      slug = clasificacion.etiqueta;
      tokensEntrada = clasificacion.tokensEntrada ?? 0;
      tokensSalida = clasificacion.tokensSalida ?? 0;
      resultadoClaude = clasificacion.resultado ?? (slug ? 'exito' : 'sin_coincidencia');
      llamadaReal = true;
    } catch (err) {
      llamadaReal = err.llamadaReal !== false;
      resultadoClaude =
        err.code === 'CLAUDE_TIMEOUT'
          ? 'timeout'
          : err.code === 'CLAUDE_NOT_CONFIGURED'
            ? 'no_configurado'
            : 'error_api';
      logger.warn(
        {
          whatsappMessageId: mensaje.whatsapp_message_id,
          pipeline: repository.PIPELINE_ANTERIOR,
          codigo: err.code ?? null,
        },
        'El clasificador del flujo anterior usará la plantilla de respaldo.',
      );
    }

    if (llamadaReal) {
      await repository.registrarEventoMetrica({
        claveEvento: `claude:legacy:mensaje:${mensaje.id}`,
        tipoEvento: 'llamada_claude',
        pipelineAsignado: repository.PIPELINE_ANTERIOR,
        mensajeId: mensaje.id,
        resultado: resultadoClaude,
      });
    }

    let plantilla = await resolverPlantillaPorSlug(slug);
    if (!plantilla) plantilla = await resolverPlantillaPorSlug(SLUG_SIN_COINCIDENCIA);
    const respuesta = normalizarFormatoWhatsapp(
      plantilla?.texto_respuesta ?? TEXTO_RESPALDO_ABSOLUTO,
    );
    const categoria = plantilla
      ? (CATEGORIA_POR_SLUG_GENERICO[plantilla.slug] ?? 'duda_medica')
      : 'sin_coincidencia';

    await repository.guardarDecisionMensajeFlujoAnterior(mensaje.id, {
      categoria,
      plantillaId: plantilla?.id ?? null,
      tokensEntrada,
      tokensSalida,
      resultado: resultadoClaude === 'exito' ? 'plantilla' : 'plantilla_respaldo',
    });
    if (plantilla) await plantillasRepository.incrementarUso(plantilla.id);

    await outbox.registrarIntento({
      claveIdempotencia: claveEnvio,
      tipoEnvio: 'conversacional',
      origenFuncional: 'respuesta_automatica',
      conversacionId: null,
      destinatarioTelefono: normalizarNumeroSalida(mensaje.telefono_origen),
      payloadFuncional: {
        tipo: 'text',
        destinatarioTelefono: normalizarNumeroSalida(mensaje.telefono_origen),
        texto: respuesta,
      },
      usaPlantilla: false,
    });
    const resultado = await outbox.ejecutarIntento(claveEnvio);
    if (resultado.enviado) await repository.completarMensajeFlujoAnterior(mensaje.id, true);
    else await repository.liberarMensajeFlujoAnterior(mensaje.id);
  } catch (err) {
    await repository.liberarMensajeFlujoAnterior(mensaje.id);
    throw err;
  }
  return mensaje.id;
}

async function intentarEnvioMenu(datosIntento) {
  const { intent } = await outbox.registrarIntento(datosIntento);
  try {
    return await outbox.ejecutarIntento(intent.clave_idempotencia);
  } catch (err) {
    return { enviado: false, error: err.message, errorCodigo: null };
  }
}

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
    telefono_no_coincide: laboratorioConsulta.textoTelefonoNoRegistrado(),
    rechazo: laboratorioConsulta.textoRechazoGenerico(),
    limite_intentos: laboratorioConsulta.textoLimiteIntentos(),
    exito: labDatos
      ? laboratorioConsulta.textoEstadoOrden(labDatos.folioId, labDatos.estadoOrden)
      : null,
  };
  const texto = textosPorAccion[labAccion];
  if (!texto) return null;

  const resultado = await intentarEnvioMenu({
    claveIdempotencia: `${claveBase}:${labAccion}`,
    tipoEnvio: 'conversacional',
    origenFuncional: 'respuesta_automatica',
    conversacionId,
    destinatarioTelefono: telefono,
    payloadFuncional: { tipo: 'text', destinatarioTelefono: telefono, texto },
    usaPlantilla: false,
  });

  if (labAccion !== 'telefono_no_coincide') return resultado;
  if (!resultado.enviado) {
    logger.warn(
      { conversacionId, mensajeId, resultado: 'envio_resultados_denegado' },
      'No se pudo enviar el aviso de protección de datos; la conversación permanece abierta.',
    );
    return { ...resultado, conversacionCerrada: false };
  }

  const conversacionCerrada = await repository.confirmarAvisoPrivacidadLaboratorioEnviado({
    conversacionId,
    mensajeId,
    ahora: new Date(),
  });
  return { ...resultado, conversacionCerrada };
}

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
        const plantillasActivas = await plantillasRepository.findActivasParaClasificar();
        let slug = null;
        let tokensEntrada = 0;
        let tokensSalida = 0;
        let errorClasificador = null;
        let llamadasClaude = 0;
        let resultadoClaude = 'no_usado';
        try {
          const nombresConocidos = await repository.obtenerNombresConocidosPorTelefono(telefono);
          const clasificacion = await claude.clasificarMensaje(
            textoConsolidado,
            plantillasActivas,
            SLUG_POR_CATEGORIA_GENERICA,
            { nombresConocidos },
          );
          slug = clasificacion.etiqueta;
          tokensEntrada = clasificacion.tokensEntrada ?? 0;
          tokensSalida = clasificacion.tokensSalida ?? 0;
          llamadasClaude = 1;
          resultadoClaude = clasificacion.resultado ?? (slug ? 'exito' : 'sin_coincidencia');
        } catch (err) {
          errorClasificador = err;
          llamadasClaude = err.llamadaReal === false ? 0 : 1;
          resultadoClaude =
            err.code === 'CLAUDE_TIMEOUT'
              ? 'timeout'
              : err.code === 'CLAUDE_NOT_CONFIGURED'
                ? 'no_configurado'
                : 'error_api';
          logger.warn(
            { conversacionId, groupId, codigo: err.code ?? null, tipo: err.name },
            'El clasificador no resolvió el grupo; se usará la plantilla de respaldo.',
          );
        }

        await repository.registrarResultadoClaudeGrupo(groupId, {
          llamadaReal: llamadasClaude > 0,
          resultado: resultadoClaude,
          tokensEntrada,
          tokensSalida,
          claveIntento: reclamoId,
        });

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
          grupoReprogramado = await repository.incorporarFragmentosTardiosAlGrupo(trx, {
            conversacionId,
            groupId,
            reclamoId,
          });
          if (grupoReprogramado) return;

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
            llamadasClaude,
            resultadoClaude,
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
            const emergenciaConfirmada = await repository.insertarEmergenciaConfirmada(trx, {
              conversacionId,
              groupId,
              plantillaId,
              slug: slugResuelto,
              respuestaDefinitiva,
              intentoEnvioId,
            });
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

  await repository.marcarGrupoProcesado(groupId);
  if (!grupo.es_emergencia_resuelta) {
    await repository.finalizarConversacionTrasGrupo(conversacionId, new Date());
    return 'clasificado_normal';
  }
  return 'clasificado_emergencia';
}

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
    logger.error(
      { conversacionId, errorCodigo: resultado.errorCodigo, error: resultado.error },
      'No se pudo confirmar el envío de la guía de medio no interpretable.',
    );
    return false;
  }

  return repository.confirmarGuiaMedioEnviada(conversacionId, groupId);
}

async function enrutarGrupo({ conversacionId, grupo, contexto, reintentos = 0 }) {
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
    // Bug real encontrado en vivo (19-sep-2026): un botón/lista interactiva
    // huérfana podía quedar 'pendiente' con group_id null (ningún estado
    // determinista la reconoció al llegar) y colarse en un grupo de texto ya
    // existente. formarGrupoParaConversacion (whatsapp.repository.js) ya
    // evita que esto vuelva a pasar en grupos NUEVOS, pero un grupo que
    // quedó contaminado ANTES de ese fix se reutilizaba para siempre
    // (rama "existente" de esa misma función) sin que nada lo resolviera —
    // cada mensaje real posterior de esa conversación (incluida una
    // emergencia) se quedaba sin agrupar y sin respuesta indefinidamente.
    // Aquí se repara en cuanto se detecta: se libera el mensaje interactivo
    // del grupo (nunca debió agruparse), se descarta el grupo contaminado, y
    // se reintenta UNA vez, en el mismo ciclo, para que los mensajes reales
    // que quedaron atrás formen su propio grupo limpio de inmediato — sin
    // esperar el ciclo de recuperación de huérfanos (2 minutos por default).
    logger.error(
      { conversacionId, groupId: grupo.groupId },
      'Una respuesta interactiva alcanzó indebidamente el router de grupos; se descarta el grupo contaminado.',
    );
    await db.transaction(async (trx) => {
      // Libera las respuestas interactivas: nunca debieron agruparse, se
      // marcan resueltas para no quedar dando vueltas para siempre.
      await trx('mensajes_whatsapp')
        .where({ group_id: grupo.groupId })
        .whereIn('tipo_mensaje', ['interactive_list_reply', 'interactive_button_reply'])
        .update({ group_id: null, estado_procesamiento: 'procesado', procesado_en: trx.fn.now() });
      // Bug encontrado al probar el fix de arriba: si el texto real que
      // venía en el MISMO grupo contaminado se dejaba con group_id
      // apuntando al grupo descartado, marcarGrupoProcesado (abajo) lo
      // marcaba 'procesado' sin haberlo clasificado NUNCA — el tutor se
      // quedaba sin respuesta igual que con el bug original, solo que
      // ahora en silencio "exitoso" en vez de atorado. Se libera aquí
      // (group_id null, sigue 'pendiente') para que el reintento
      // inmediato de abajo lo recoja en un grupo limpio de verdad.
      await trx('mensajes_whatsapp')
        .where({ group_id: grupo.groupId, estado_procesamiento: 'pendiente' })
        .update({ group_id: null });
      await repository.persistirDecisionDeterministaGrupo(trx, grupo.groupId, {
        rutaEnrutamiento: ruta,
        intencionResuelta: 'descartar_respuesta_interactiva',
        resultadoDecision: 'grupo_contaminado_descartado',
        respuestaDefinitiva: null,
      });
      await repository.marcarGrupoProcesado(grupo.groupId, trx);
    });

    if (reintentos === 0) {
      const grupoNuevo = await repository.formarGrupoParaConversacion(conversacionId);
      if (grupoNuevo) {
        await repository.registrarIntentoEnrutamientoGrupo(grupoNuevo.groupId);
        return enrutarGrupo({ conversacionId, grupo: grupoNuevo, contexto, reintentos: 1 });
      }
    }
    return 'respuesta_interactiva_descartada';
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

async function procesarSiguienteConversacionVencida() {
  const inicio = Date.now();
  const conversacionId = await repository.reclamarConversacionVencida({
    segundosRecuperacion: env.whatsapp.agrupacionReclamoHuerfanoMinutos * 60,
  });
  if (!conversacionId) return null;

  const contexto = await repository.obtenerContextoDeConversacion(conversacionId);

  const grupo = await repository.formarGrupoParaConversacion(conversacionId);
  if (!grupo) return null;
  await repository.registrarIntentoEnrutamientoGrupo(grupo.groupId);
  const resultado = await enrutarGrupo({ conversacionId, grupo, contexto });
  logger.info(
    {
      conversacionId,
      groupId: grupo.groupId,
      pipeline: repository.PIPELINE_NUEVO,
      resultado,
      duracionMs: Date.now() - inicio,
    },
    'Grupo de WhatsApp procesado por el router conversacional.',
  );
  return { ...grupo, resultado };
}

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

async function cerrarSiguienteConversacionInactiva() {
  return repository.cerrarConversacionPorInactividad();
}

async function reenviarSeguimiento({ conversacionId, telefono, mensajeId }) {
  return enviarSeguimiento({
    conversacionId,
    telefono,
    claveIdempotencia: `mensaje:${mensajeId}:seguimiento-invalido`,
  });
}

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
      aviso_privacidad_pendiente: 'telefono_no_coincide',
      esperando_telefono_y_folio: 'telefono_no_coincide',
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
  procesarSiguienteMensajeFlujoAnterior,
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
