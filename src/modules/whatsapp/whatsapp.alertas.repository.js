const db = require('../../config/database');
const env = require('../../config/env');

async function crearAlerta(datos, trx) {
  const conexion = trx ?? db;
  const [creada] = await conexion('alertas_atencion_whatsapp')
    .insert({
      clave_idempotencia: datos.claveIdempotencia,
      tipo_alerta: datos.tipoAlerta,
      conversacion_id: datos.conversacionId,
      grupo_id: datos.grupoId ?? null,
      mensaje_origen_id: datos.mensajeOrigenId ?? null,
      whatsapp_message_id_origen: datos.whatsappMessageIdOrigen ?? null,
      telefono_externo: datos.telefonoExterno ?? null,
      origen: datos.origen,
      prioridad: datos.prioridad ?? null,
      tokens_entrada: datos.tokensEntrada ?? 0,
      tokens_salida: datos.tokensSalida ?? 0,
      creado_en: datos.solicitadaEn ?? conexion.fn.now(),
    })
    .onConflict('clave_idempotencia')
    .ignore()
    .returning('*');
  const alerta =
    creada ??
    (await conexion('alertas_atencion_whatsapp')
      .where({ clave_idempotencia: datos.claveIdempotencia })
      .first());
  return { alerta, esNueva: Boolean(creada) };
}

async function resolverUsuarios(tipoUsuario, trx) {
  return trx('usuarios')
    .where({
      estatus: 'activo',
      tipo_usuario: tipoUsuario,
      notificaciones_alertas: true,
    })
    .orderBy('id', 'asc')
    .select('id', 'tipo_usuario', 'notificaciones_alertas', 'telefono');
}

async function guardarResolucion(alertaId, resolucion, trx) {
  await trx('alertas_atencion_whatsapp').where({ id: alertaId }).update({
    resolucion_destinatarios: resolucion,
    actualizado_en: trx.fn.now(),
  });
}

async function guardarDestinatarios(alertaId, usuarios, esRespaldoAdmin, normalizarTelefono, trx) {
  if (usuarios.length === 0) return [];
  return trx('destinatarios_alerta_whatsapp')
    .insert(
      usuarios.map((usuario) => ({
        alerta_id: alertaId,
        usuario_id: usuario.id,
        tipo_usuario: usuario.tipo_usuario,
        notificaciones_alertas: usuario.notificaciones_alertas,
        telefono_normalizado: normalizarTelefono(usuario.telefono),
        es_respaldo_admin: esRespaldoAdmin,
      })),
    )
    .onConflict(['alerta_id', 'usuario_id'])
    .ignore()
    .returning('*');
}

async function buscarDestinatarios(alertaId, trx) {
  const conexion = trx ?? db;
  return conexion('destinatarios_alerta_whatsapp')
    .where({ alerta_id: alertaId })
    .orderBy('id', 'asc');
}

async function buscarSiguientePendienteResolucion(trx) {
  return trx('alertas_atencion_whatsapp')
    .where({ estado: 'pendiente', resolucion_destinatarios: 'pendiente' })
    .orderBy('creado_en', 'asc')
    .orderBy('id', 'asc')
    .forUpdate()
    .skipLocked()
    .first();
}

async function registrarIntentoCanal(datos, trx) {
  const conexion = trx ?? db;
  const [creado] = await conexion('intentos_alerta_whatsapp')
    .insert({
      clave_idempotencia: datos.claveIdempotencia,
      alerta_id: datos.alertaId,
      destinatario_id: datos.destinatarioId ?? null,
      canal: datos.canal,
      destino_normalizado: datos.destinoNormalizado ?? null,
      numero_intento: datos.numeroIntento ?? 0,
      estado: datos.estado ?? 'pendiente',
      error_tecnico: datos.errorTecnico ?? null,
      intentado_en: datos.intentadoEn ?? null,
    })
    .onConflict('clave_idempotencia')
    .ignore()
    .returning('*');
  return (
    creado ??
    conexion('intentos_alerta_whatsapp')
      .where({ clave_idempotencia: datos.claveIdempotencia })
      .first()
  );
}

async function vincularOutbox(intentoId, outboxId, trx) {
  await trx('intentos_alerta_whatsapp').where({ id: intentoId }).update({
    outbox_id: outboxId,
    actualizado_en: trx.fn.now(),
  });
}

async function reclamarEnvioWhatsapp() {
  return db.transaction(async (trx) => {
    const intento = await trx({ intento: 'intentos_alerta_whatsapp' })
      .join({ alerta: 'alertas_atencion_whatsapp' }, 'alerta.id', 'intento.alerta_id')
      .where('intento.canal', 'whatsapp')
      .andWhere((builder) =>
        builder
          .whereIn('intento.estado', ['pendiente', 'fallido'])
          .orWhere((abandonado) =>
            abandonado
              .where('intento.estado', 'enviando')
              .andWhere(
                'intento.intentado_en',
                '<=',
                trx.raw(
                  `now() - interval '${Number(env.whatsapp.workerReclamoHuerfanoSegundos)} seconds'`,
                ),
              ),
          ),
      )
      .where('alerta.estado', 'pendiente')
      .whereNotNull('intento.outbox_id')
      .where((builder) =>
        builder
          .whereNull('intento.proximo_intento_en')
          .orWhere('intento.proximo_intento_en', '<=', trx.fn.now()),
      )
      .orderBy('intento.creado_en', 'asc')
      .orderBy('intento.id', 'asc')
      .forUpdate('intento')
      .skipLocked()
      .first(
        'intento.id',
        'intento.alerta_id',
        'intento.clave_idempotencia',
        'intento.numero_intento',
        'intento.outbox_id',
      );
    if (!intento) return null;

    const [reclamado] = await trx('intentos_alerta_whatsapp')
      .where({ id: intento.id })
      .update({
        estado: 'enviando',
        numero_intento: trx.raw('numero_intento + 1'),
        intentado_en: trx.fn.now(),
        actualizado_en: trx.fn.now(),
      })
      .returning('*');
    return reclamado;
  });
}

async function buscarOutbox(outboxId) {
  return db('outbox_whatsapp').where({ intent_id: outboxId }).first();
}

async function marcarEnvioWhatsapp(intentoId, resultado, reintentoSegundos = 30) {
  const cambios = {
    estado: resultado.estado,
    identificador_externo: resultado.identificadorExterno ?? null,
    error_tecnico: resultado.errorTecnico ?? null,
    proximo_intento_en:
      resultado.estado === 'fallido'
        ? db.raw(`now() + interval '${Number(reintentoSegundos)} seconds'`)
        : null,
    actualizado_en: db.fn.now(),
  };
  await db('intentos_alerta_whatsapp').where({ id: intentoId }).update(cambios);
}

async function usuarioActual(usuarioId, trx) {
  const conexion = trx ?? db;
  return conexion('usuarios')
    .where({ id: usuarioId })
    .first('id', 'estatus', 'tipo_usuario', 'notificaciones_alertas');
}

function usuarioPuedeAtender(usuario, alerta) {
  if (!usuario || usuario.estatus !== 'activo' || usuario.notificaciones_alertas !== true) {
    return false;
  }
  const tipoPrincipal = alerta.tipo_alerta === 'emergencia' ? 'doctor' : 'recepcion';
  if (usuario.tipo_usuario === tipoPrincipal) return true;
  return usuario.tipo_usuario === 'admin' && alerta.resolucion_destinatarios === 'respaldo_admin';
}

async function listarPendientesParaUsuario(usuarioId) {
  const usuario = await usuarioActual(usuarioId);
  if (!usuario || usuario.estatus !== 'activo' || !usuario.notificaciones_alertas) return [];

  return db('alertas_atencion_whatsapp')
    .where({ estado: 'pendiente' })
    .whereNot({ resolucion_destinatarios: 'pendiente' })
    .andWhere((builder) => {
      if (usuario.tipo_usuario === 'doctor') builder.where({ tipo_alerta: 'emergencia' });
      else if (usuario.tipo_usuario === 'recepcion') builder.where({ tipo_alerta: 'recepcion' });
      else if (usuario.tipo_usuario === 'admin') {
        builder.where({ resolucion_destinatarios: 'respaldo_admin' });
      } else builder.whereRaw('false');
    })
    .orderBy('creado_en', 'asc')
    .select(
      'id',
      'tipo_alerta',
      'conversacion_id',
      'telefono_externo',
      'origen',
      'resolucion_destinatarios',
      'creado_en',
    );
}

async function registrarVisualizacionPortal(alertaIds, usuarioId) {
  if (alertaIds.length === 0) return;
  await db.transaction(async (trx) => {
    for (const alertaId of alertaIds) {
      const clave = `alerta:${alertaId}:usuario:${usuarioId}:portal`;
      const intento = await registrarIntentoCanal(
        {
          claveIdempotencia: clave,
          alertaId,
          canal: 'portal',
          destinoNormalizado: `usuario:${usuarioId}`,
        },
        trx,
      );
      if (intento.estado === 'pendiente' || intento.estado === 'fallido') {
        await trx('intentos_alerta_whatsapp')
          .where({ id: intento.id })
          .update({
            estado: 'enviado',
            numero_intento: trx.raw('numero_intento + 1'),
            intentado_en: trx.fn.now(),
            error_tecnico: null,
            actualizado_en: trx.fn.now(),
          });
      }
    }
  });
}

async function registrarResultadoNavegador(alertaId, usuarioId, { estado, errorTecnico }) {
  return db.transaction(async (trx) => {
    const alerta = await trx('alertas_atencion_whatsapp').where({ id: alertaId }).first();
    const usuario = await usuarioActual(usuarioId, trx);
    if (!alerta || alerta.estado !== 'pendiente' || !usuarioPuedeAtender(usuario, alerta)) {
      return false;
    }
    const intento = await registrarIntentoCanal(
      {
        claveIdempotencia: `alerta:${alertaId}:usuario:${usuarioId}:navegador`,
        alertaId,
        canal: 'navegador',
        destinoNormalizado: `usuario:${usuarioId}`,
      },
      trx,
    );
    if (intento.estado === 'enviado' && estado === 'enviado') return true;
    await trx('intentos_alerta_whatsapp')
      .where({ id: intento.id })
      .update({
        estado,
        numero_intento: trx.raw('numero_intento + 1'),
        intentado_en: trx.fn.now(),
        error_tecnico: errorTecnico ?? null,
        actualizado_en: trx.fn.now(),
      });
    return true;
  });
}

async function atender(alertaId, usuarioId) {
  return db.transaction(async (trx) => {
    const alerta = await trx('alertas_atencion_whatsapp')
      .where({ id: alertaId })
      .forUpdate()
      .first();
    if (!alerta) return { resultado: 'no_encontrada' };
    if (alerta.estado === 'atendida') return { resultado: 'ya_atendida', alerta };

    const usuario = await usuarioActual(usuarioId, trx);
    if (!usuarioPuedeAtender(usuario, alerta)) return { resultado: 'no_autorizado' };

    const [actualizada] = await trx('alertas_atencion_whatsapp')
      .where({ id: alertaId, estado: 'pendiente' })
      .update({
        estado: 'atendida',
        atendida_por: usuarioId,
        atendida_en: trx.fn.now(),
        actualizado_en: trx.fn.now(),
      })
      .returning('*');
    return actualizada
      ? { resultado: 'atendida', alerta: actualizada }
      : { resultado: 'ya_atendida' };
  });
}

async function obtenerAuditoria(alertaId) {
  const alerta = await db('alertas_atencion_whatsapp').where({ id: alertaId }).first();
  if (!alerta) return null;
  const [destinatarios, intentos] = await Promise.all([
    buscarDestinatarios(alertaId),
    db('intentos_alerta_whatsapp').where({ alerta_id: alertaId }).orderBy('id', 'asc'),
  ]);
  return { alerta, destinatarios, intentos };
}

async function esWamidDeAlertaInterna(wamid) {
  if (!wamid) return false;
  const fila = await db('outbox_whatsapp')
    .where({ wamid, origen_funcional: 'alerta_interna_personal' })
    .first('intent_id');
  return Boolean(fila);
}

module.exports = {
  crearAlerta,
  resolverUsuarios,
  guardarResolucion,
  guardarDestinatarios,
  buscarDestinatarios,
  buscarSiguientePendienteResolucion,
  registrarIntentoCanal,
  vincularOutbox,
  reclamarEnvioWhatsapp,
  buscarOutbox,
  marcarEnvioWhatsapp,
  listarPendientesParaUsuario,
  registrarVisualizacionPortal,
  registrarResultadoNavegador,
  atender,
  obtenerAuditoria,
  esWamidDeAlertaInterna,
  usuarioPuedeAtender,
};
