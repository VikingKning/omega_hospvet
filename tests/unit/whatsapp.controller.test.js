// Reglas de extracción del POST del webhook (whatsapp.controller.js#recibir)
// — antes solo se procesaban mensajes de texto; ahora una foto con caption
// también se manda a clasificar (Claude nunca ve la imagen en sí, solo el
// texto del caption). Se mockea whatsapp.service porque estas pruebas son
// sobre CUÁLES mensajes llegan al service con qué texto, no sobre la
// clasificación en sí (eso ya está cubierto en whatsapp.service.test.js).
jest.mock('../../src/config/whatsapp');
jest.mock('../../src/modules/whatsapp/whatsapp.service');
const whatsappConfig = require('../../src/config/whatsapp');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const controller = require('../../src/modules/whatsapp/whatsapp.controller');

function makeReq(body) {
  return {
    rawBody: Buffer.from(JSON.stringify(body)),
    body,
    get: () => 'sha256=firma-fake',
    log: { error: jest.fn() },
  };
}

function makeRes() {
  return { sendStatus: jest.fn() };
}

function payloadConMensaje(mensaje) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [{ value: { messages: [mensaje] }, field: 'messages' }],
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  whatsappConfig.verificarFirma.mockReturnValue(true);
  service.procesarMensajeEntrante.mockResolvedValue();
});

describe('whatsapp.controller.recibir — qué mensajes se mandan a clasificar', () => {
  it('un mensaje de texto manda su text.body', async () => {
    const req = makeReq(
      payloadConMensaje({
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hola' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.procesarMensajeEntrante).toHaveBeenCalledWith(
      expect.objectContaining({ telefono: '5215500000000', texto: 'hola' }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('una foto con caption manda el caption como texto', async () => {
    const req = makeReq(
      payloadConMensaje({
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'image',
        image: { id: 'media-1', caption: 'le salió una herida, aquí la foto' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.procesarMensajeEntrante).toHaveBeenCalledWith(
      expect.objectContaining({ texto: 'le salió una herida, aquí la foto' }),
    );
  });

  it('una foto SIN caption no manda nada a clasificar (no hay texto)', async () => {
    const req = makeReq(
      payloadConMensaje({
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'image',
        image: { id: 'media-1' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.procesarMensajeEntrante).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('un tipo de mensaje que no es texto ni imagen (ej. audio) se ignora', async () => {
    const req = makeReq(
      payloadConMensaje({
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'audio',
        audio: { id: 'media-1' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.procesarMensajeEntrante).not.toHaveBeenCalled();
  });

  it('sin firma válida, responde 401 y no llama al service', async () => {
    whatsappConfig.verificarFirma.mockReturnValue(false);
    const req = makeReq(
      payloadConMensaje({ from: '1', timestamp: '1', type: 'text', text: { body: 'x' } }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(service.procesarMensajeEntrante).not.toHaveBeenCalled();
  });
});
