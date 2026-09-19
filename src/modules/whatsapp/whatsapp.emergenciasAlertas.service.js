const alertasService = require('./whatsapp.alertas.service');

class EmergenciaAlertaValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

async function registrarDesdeEmergenciaConfirmada({ emergenciaConfirmada, telefonoExterno, trx }) {
  if (!emergenciaConfirmada || emergenciaConfirmada.es_emergencia !== true) return null;
  if (
    !emergenciaConfirmada.id ||
    !emergenciaConfirmada.conversacion_id ||
    !emergenciaConfirmada.group_id ||
    !emergenciaConfirmada.confirmado_en
  ) {
    throw new EmergenciaAlertaValidationError(
      'La señal de emergencia confirmada no contiene sus referencias persistidas.',
    );
  }

  return alertasService.registrarSolicitudAlerta({
    claveIdempotencia: `emergencia:${emergenciaConfirmada.group_id}`,
    tipoAlerta: 'emergencia',
    conversacionId: emergenciaConfirmada.conversacion_id,
    grupoId: emergenciaConfirmada.group_id,
    telefonoExterno,
    origen: 'emergencia_whatsapp',
    prioridad: 'critica',
    solicitadaEn: emergenciaConfirmada.confirmado_en,
    tokensEntrada: 0,
    tokensSalida: 0,
    trx,
  });
}

module.exports = { registrarDesdeEmergenciaConfirmada, EmergenciaAlertaValidationError };
