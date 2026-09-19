jest.mock('../../src/modules/whatsapp/whatsapp.alertas.service');

const alertasService = require('../../src/modules/whatsapp/whatsapp.alertas.service');
const {
  registrarDesdeEmergenciaConfirmada,
  EmergenciaAlertaValidationError,
} = require('../../src/modules/whatsapp/whatsapp.emergenciasAlertas.service');

beforeEach(() => {
  jest.clearAllMocks();
  alertasService.registrarSolicitudAlerta.mockResolvedValue({
    alerta: { id: 90 },
    esNueva: true,
  });
});

describe('US WA 016 — generación determinista desde emergencia_confirmada', () => {
  const senal = {
    id: 44,
    conversacion_id: 10,
    group_id: 20,
    plantilla_id: 30,
    es_emergencia: true,
    confirmado_en: new Date('2026-09-15T18:00:00Z'),
  };

  it('entrega a WA018 el contrato mínimo, crítico e idempotente por grupo', async () => {
    await registrarDesdeEmergenciaConfirmada({
      emergenciaConfirmada: senal,
      telefonoExterno: '525500001111',
      trx: 'trx-fake',
    });

    expect(alertasService.registrarSolicitudAlerta).toHaveBeenCalledWith({
      claveIdempotencia: 'emergencia:20',
      tipoAlerta: 'emergencia',
      conversacionId: 10,
      grupoId: 20,
      telefonoExterno: '525500001111',
      origen: 'emergencia_whatsapp',
      prioridad: 'critica',
      solicitadaEn: senal.confirmado_en,
      tokensEntrada: 0,
      tokensSalida: 0,
      trx: 'trx-fake',
    });
  });

  it.each([null, { ...senal, es_emergencia: false }])(
    'ignora una señal ausente o no confirmada: %p',
    async (emergenciaConfirmada) => {
      await expect(
        registrarDesdeEmergenciaConfirmada({ emergenciaConfirmada, telefonoExterno: '52' }),
      ).resolves.toBeNull();
      expect(alertasService.registrarSolicitudAlerta).not.toHaveBeenCalled();
    },
  );

  it('rechaza una señal confirmada incompleta sin inventar referencias', async () => {
    await expect(
      registrarDesdeEmergenciaConfirmada({
        emergenciaConfirmada: { id: 1, es_emergencia: true },
        telefonoExterno: '525500001111',
      }),
    ).rejects.toBeInstanceOf(EmergenciaAlertaValidationError);
    expect(alertasService.registrarSolicitudAlerta).not.toHaveBeenCalled();
  });
});
