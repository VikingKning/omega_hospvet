// Reglas de extracción y persistencia del POST del webhook
// (whatsapp.controller.js#recibir). Se mockea whatsapp.service porque
// estas pruebas son sobre QUÉ se extrae de cada tipo de mensaje — no sobre
// la clasificación en sí (whatsapp.service.test.js) ni sobre la
// idempotencia real de Postgres (tests/integration/whatsapp.test.js,
// necesita la restricción UNIQUE de verdad). US WA 003: el controller ya
// NO dispara ningún procesamiento en segundo plano — solo persiste.
jest.mock('../../src/config/whatsapp');
jest.mock('../../src/modules/whatsapp/whatsapp.service');
jest.mock('../../src/modules/whatsapp/whatsapp.outbox');
const whatsappConfig = require('../../src/config/whatsapp');
const service = require('../../src/modules/whatsapp/whatsapp.service');
const outbox = require('../../src/modules/whatsapp/whatsapp.outbox');
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
        changes: [
          {
            value: { metadata: { phone_number_id: 'phone-1' }, messages: [mensaje] },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  whatsappConfig.verificarFirma.mockReturnValue(true);
  service.registrarEventoEntrante.mockResolvedValue({ id: 1, esNuevo: true });
  service.enviarMenuPrincipal.mockResolvedValue(true);
  service.reenviarSeguimiento.mockResolvedValue({ enviado: true });
  service.enviarSeleccionInvalida.mockResolvedValue(true);
  outbox.registrarEstadoMeta.mockResolvedValue();
});

describe('whatsapp.controller.extraerEventosEntrantes — qué se extrae de cada tipo de mensaje', () => {
  it('un mensaje de texto extrae su text.body como contenido', () => {
    const eventos = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hola' },
      }),
    );

    expect(eventos).toEqual([
      {
        whatsappMessageId: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        phoneNumberId: 'phone-1',
        tipoMensaje: 'text',
        contenido: 'hola',
        mediaId: null,
      },
    ]);
  });

  it('una imagen con caption extrae el caption como contenido y guarda el media id', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.2',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'image',
        image: { id: 'media-1', caption: 'le salió una herida, aquí la foto' },
      }),
    );

    expect(evento).toMatchObject({
      tipoMensaje: 'image',
      contenido: 'le salió una herida, aquí la foto',
      mediaId: 'media-1',
    });
  });

  it('una imagen SIN caption extrae contenido null pero conserva el media id', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.3',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'image',
        image: { id: 'media-1' },
      }),
    );

    expect(evento).toMatchObject({ tipoMensaje: 'image', contenido: null, mediaId: 'media-1' });
  });

  it('una imagen conserva el mime_type que reporta Meta (US WA 014, técnica)', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.3b',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg' },
      }),
    );

    expect(evento.mimeType).toBe('image/jpeg');
  });

  it('un documento CON caption extrae el caption como contenido (US WA 014 AC2)', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.3c',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'document',
        document: { id: 'media-doc', caption: 'aquí el estudio', mime_type: 'application/pdf' },
      }),
    );

    expect(evento).toMatchObject({
      tipoMensaje: 'document',
      contenido: 'aquí el estudio',
      mediaId: 'media-doc',
      mimeType: 'application/pdf',
    });
  });

  it('un documento SIN caption extrae contenido null pero conserva media id y mime_type', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.3d',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'document',
        document: { id: 'media-doc', mime_type: 'application/pdf' },
      }),
    );

    expect(evento).toMatchObject({
      tipoMensaje: 'document',
      contenido: null,
      mediaId: 'media-doc',
      mimeType: 'application/pdf',
    });
  });

  it('una selección de lista interactiva extrae el id de la opción elegida', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.4',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'opcion_1', title: 'Agendar cita' } },
      }),
    );

    expect(evento).toMatchObject({
      tipoMensaje: 'interactive_list_reply',
      contenido: 'opcion_1',
      mediaId: null,
      tituloInteractivo: 'Agendar cita',
    });
  });

  it('una respuesta de botón extrae el id del botón elegido', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.5',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'boton_si', title: 'Sí' } },
      }),
    );

    expect(evento).toMatchObject({
      tipoMensaje: 'interactive_button_reply',
      contenido: 'boton_si',
      mediaId: null,
      tituloInteractivo: 'Sí',
    });
  });

  it.each(['audio', 'video', 'document', 'sticker'])(
    'un mensaje de tipo %s no interpretable conserva su tipo y media_id, sin contenido',
    (tipo) => {
      const [evento] = controller.extraerEventosEntrantes(
        payloadConMensaje({
          id: 'wamid.6',
          from: '5215500000000',
          timestamp: '1700000000',
          type: tipo,
          [tipo]: { id: 'media-9' },
        }),
      );

      expect(evento).toMatchObject({ tipoMensaje: tipo, contenido: null, mediaId: 'media-9' });
    },
  );

  it.each(['audio', 'video', 'sticker'])(
    'un mensaje de tipo %s conserva el mime_type que reporta Meta (US WA 014, técnica)',
    (tipo) => {
      const [evento] = controller.extraerEventosEntrantes(
        payloadConMensaje({
          id: 'wamid.6b',
          from: '5215500000000',
          timestamp: '1700000000',
          type: tipo,
          [tipo]: { id: 'media-9', mime_type: 'application/octet-stream' },
        }),
      );

      expect(evento.mimeType).toBe('application/octet-stream');
    },
  );

  it('un tipo desconocido para este sistema conserva el tipo que mandó Meta, sin contenido', () => {
    const [evento] = controller.extraerEventosEntrantes(
      payloadConMensaje({
        id: 'wamid.7',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'location',
        location: { latitude: 1, longitude: 2 },
      }),
    );

    expect(evento).toMatchObject({ tipoMensaje: 'location', contenido: null, mediaId: null });
  });

  it('un evento de estado (statuses) sin messages no produce ningún evento', () => {
    const eventos = controller.extraerEventosEntrantes({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [{ value: { statuses: [{ id: 'wamid.fake', status: 'delivered' }] } }],
        },
      ],
    });

    expect(eventos).toEqual([]);
  });
});

describe('whatsapp.controller.extraerEstadosEntrantes — US WA 015 AC3', () => {
  it('un webhook de estado extrae wamid y estadoMeta', () => {
    const estados = controller.extraerEstadosEntrantes({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            { value: { statuses: [{ id: 'wamid.123', status: 'delivered' }] }, field: 'messages' },
          ],
        },
      ],
    });

    expect(estados).toEqual([{ wamid: 'wamid.123', estadoMeta: 'delivered' }]);
  });

  it('un payload de solo mensajes (sin statuses) no produce ningún estado', () => {
    const estados = controller.extraerEstadosEntrantes(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hola' },
      }),
    );

    expect(estados).toEqual([]);
  });
});

describe('whatsapp.controller.recibir — solo persiste, sin disparar nada en segundo plano (US WA 003 AC4/AC9)', () => {
  it('un mensaje nuevo con contenido se persiste sin disparar ningún procesamiento', async () => {
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hola' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.registrarEventoEntrante).toHaveBeenCalledWith(
      expect.objectContaining({ from: '5215500000000', contenido: 'hola' }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('una imagen SIN caption también se persiste, sin disparar nada', async () => {
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'image',
        image: { id: 'media-1' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.registrarEventoEntrante).toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('un payload con varios mensajes distintos persiste cada uno independientemente', async () => {
    service.registrarEventoEntrante
      .mockResolvedValueOnce({ id: 1, esNuevo: true })
      .mockResolvedValueOnce({ id: 2, esNuevo: true });
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.1',
                    from: '5215500000001',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'uno' },
                  },
                  {
                    id: 'wamid.2',
                    from: '5215500000002',
                    timestamp: '1700000001',
                    type: 'text',
                    text: { body: 'dos' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    const req = makeReq(body);
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.registrarEventoEntrante).toHaveBeenCalledTimes(2);
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('un error de BD al persistir responde con un código recuperable distinto de 200 (no 401/200)', async () => {
    service.registrarEventoEntrante.mockRejectedValue(new Error('conexión perdida'));
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hola' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(503);
    expect(req.log.error).toHaveBeenCalled();
  });

  it('sin firma válida, responde 401 y no persiste nada', async () => {
    whatsappConfig.verificarFirma.mockReturnValue(false);
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '1',
        timestamp: '1',
        type: 'text',
        text: { body: 'x' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(service.registrarEventoEntrante).not.toHaveBeenCalled();
  });

  it('un comando de menú sobre una conversación existente dispara el envío inmediato del menú (US WA 004 AC2)', async () => {
    service.registrarEventoEntrante.mockResolvedValue({
      id: 5,
      esNuevo: true,
      conversacionId: 99,
      disparaMenuInmediato: true,
      telefonoNormalizado: '525500000000',
    });
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'menu' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.enviarMenuPrincipal).toHaveBeenCalledWith({
      conversacionId: 99,
      telefono: '525500000000',
      claveBase: 'mensaje:5',
    });
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('un mensaje normal (sin disparar el menú) no llama a enviarMenuPrincipal', async () => {
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hola' },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.enviarMenuPrincipal).not.toHaveBeenCalled();
    expect(service.reenviarSeguimiento).not.toHaveBeenCalled();
  });

  it('"volver_menu" dispara enviarMenuPrincipal, igual que un comando de menú explícito (US WA 013 AC3)', async () => {
    service.registrarEventoEntrante.mockResolvedValue({
      id: 6,
      esNuevo: true,
      conversacionId: 99,
      disparaMenuInmediato: false,
      seguimientoAccion: 'volver_menu',
      estadoResultante: 'esperando_menu',
      telefonoNormalizado: '525500000000',
    });
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'volver_menu' } },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.enviarMenuPrincipal).toHaveBeenCalledWith({
      conversacionId: 99,
      telefono: '525500000000',
      claveBase: 'mensaje:6',
    });
    expect(service.reenviarSeguimiento).not.toHaveBeenCalled();
  });

  it('"continuar" con estadoResultante esperando_menu reenvía el menú (US WA 013 AC2)', async () => {
    service.registrarEventoEntrante.mockResolvedValue({
      id: 7,
      esNuevo: true,
      conversacionId: 99,
      disparaMenuInmediato: false,
      seguimientoAccion: 'continuar',
      estadoResultante: 'esperando_menu',
      telefonoNormalizado: '525500000000',
    });
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'continuar' } },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.enviarMenuPrincipal).toHaveBeenCalledWith({
      conversacionId: 99,
      telefono: '525500000000',
      claveBase: 'mensaje:7',
    });
  });

  it('"continuar" con estadoResultante flujo_activo no dispara ningún envío (nada real que reenviar todavía)', async () => {
    service.registrarEventoEntrante.mockResolvedValue({
      id: 8,
      esNuevo: true,
      conversacionId: 99,
      disparaMenuInmediato: false,
      seguimientoAccion: 'continuar',
      estadoResultante: 'flujo_activo',
      telefonoNormalizado: '525500000000',
    });
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'continuar' } },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.enviarMenuPrincipal).not.toHaveBeenCalled();
    expect(service.reenviarSeguimiento).not.toHaveBeenCalled();
  });

  it('"invalido" reenvía la misma pregunta de seguimiento (US WA 013 AC5)', async () => {
    service.registrarEventoEntrante.mockResolvedValue({
      id: 9,
      esNuevo: true,
      conversacionId: 99,
      disparaMenuInmediato: false,
      seguimientoAccion: 'invalido',
      estadoResultante: 'flujo_activo',
      telefonoNormalizado: '525500000000',
    });
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'algo_raro' } },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.reenviarSeguimiento).toHaveBeenCalledWith({
      conversacionId: 99,
      telefono: '525500000000',
      mensajeId: 9,
    });
    expect(service.enviarMenuPrincipal).not.toHaveBeenCalled();
  });

  it('"seleccionInvalida" avisa y muestra un menú nuevo (US WA 005 AC9)', async () => {
    service.registrarEventoEntrante.mockResolvedValue({
      id: 10,
      esNuevo: true,
      conversacionId: 99,
      disparaMenuInmediato: false,
      seguimientoAccion: null,
      seleccionInvalida: true,
      estadoResultante: 'esperando_menu',
      telefonoNormalizado: '525500000000',
    });
    const req = makeReq(
      payloadConMensaje({
        id: 'wamid.1',
        from: '5215500000000',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'MENU_INVENTADO' } },
      }),
    );
    const res = makeRes();

    await controller.recibir(req, res);

    expect(service.enviarSeleccionInvalida).toHaveBeenCalledWith({
      conversacionId: 99,
      telefono: '525500000000',
      mensajeId: 10,
    });
    expect(service.enviarMenuPrincipal).not.toHaveBeenCalled();
    expect(service.reenviarSeguimiento).not.toHaveBeenCalled();
  });

  it('un webhook de estado se registra vía outbox.registrarEstadoMeta, sin tocar mensajes entrantes (US WA 015 AC3)', async () => {
    const req = makeReq({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            { value: { statuses: [{ id: 'wamid.123', status: 'sent' }] }, field: 'messages' },
          ],
        },
      ],
    });
    const res = makeRes();

    await controller.recibir(req, res);

    expect(outbox.registrarEstadoMeta).toHaveBeenCalledWith({
      wamid: 'wamid.123',
      estadoMeta: 'sent',
    });
    expect(service.registrarEventoEntrante).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });
});
