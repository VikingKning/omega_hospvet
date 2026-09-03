jest.mock('../../src/modules/agenda/agenda.repository');
jest.mock('../../src/modules/areas/areas.repository');
jest.mock('../../src/modules/tutores/tutores.repository');

const repository = require('../../src/modules/agenda/agenda.repository');
const areasRepository = require('../../src/modules/areas/areas.repository');
const tutoresRepository = require('../../src/modules/tutores/tutores.repository');
const {
  esReservaDeConsultas,
  extraerDatosReserva,
  resolverReserva,
  importarReserva,
} = require('../../src/modules/agenda/agenda.reservasExternas');

// Texto TAL CUAL lo devuelve la API real (`events.get().description`,
// confirmado en vivo contra un evento real ya reservado) — HTML, no texto
// plano como se ve en "Detalles del Evento" de la interfaz de Google
// Calendar. Bug real encontrado en vivo: los regex asumían texto plano y
// fallaban en silencio contra esto (la señal "Nombre de la Mascota" sí
// coincidía — el evento SÍ se reconocía/importaba — pero teléfono/mascota/
// tutor/correo salían null). extraerDatosReserva() ahora quita las
// etiquetas antes de aplicar los regex.
const DESCRIPCION_HTML_REAL =
  '<b>Programada por</b>\nOmegaTest VetOmega\nomegavet.test@gmail.com\n5529000090\n' +
  '<br><b>Nombre de la Mascota</b>\nSparky\n' +
  '<br><p>🐾 ¡Estamos felices de recibirte!</p>' +
  '<p>Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla.</p>' +
  '<p>• Llega al menos <strong>10 minutos antes</strong> de la hora programada.</p>' +
  '<p>Omega<br>Hospital Veterinario &amp; Estetica</p>';

// Texto plano equivalente (como se ve copiado de "Detalles del Evento" en
// la interfaz de Google Calendar) — se sigue probando aparte porque
// extraerDatosReserva() debe funcionar igual de bien contra cualquiera de
// los dos formatos.
const DESCRIPCION_TEXTO_PLANO = `Programada por
OmegaTest VetOmega
omegavet.test@gmail.com
5529000090

Nombre de la Mascota
Sparky

🐾 ¡Estamos felices de recibirte!

Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla. Selecciona el día y horario que mejor te funcione para brindarle la atención que necesita.

Para que tu visita sea lo más cómoda posible, te pedimos considerar lo siguiente:

• Llega al menos 10 minutos antes de la hora programada para realizar el registro con calma.
• Si cuentas con estudios, recetas, cartilla de vacunación o antecedentes médicos, tráelos contigo.

💙 Gracias por confiar en nosotros para cuidar la salud y bienestar de tu mascota. ¡Te esperamos!

Omega
Hospital Veterinario & Estetica`;

// Bug real encontrado en vivo, DESPUÉS de que el fix anterior ya estaba en
// producción: dos reservas reales del usuario no se reconocieron porque
// "Nombre de la Mascota" es una pregunta OPCIONAL del formulario — sin
// contestarla, esa señal no aparece en absoluto. Texto real de una de esas
// reservas (vía la API, no la interfaz).
const DESCRIPCION_HTML_SIN_MASCOTA =
  '<b>Programada por</b>\nJ. Ivan Trujillo M.\nleoivan.moreno@gmail.com\n5529000090\n' +
  '<br><p>🐾 ¡Estamos felices de recibirte!</p>' +
  '<p>Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla.</p>' +
  '<p>Omega<br>Hospital Veterinario &amp; Estetica</p>';

// Ejemplo real dado por el usuario: "Motivo de Consulta" SÍ contestado —
// además, el teléfono viene con un guion ("55-29000090", formato distinto
// a los ya probados en extraerTelefono, buen caso extra) y el nombre de la
// mascota en minúsculas ("sparky", el match de resolverReserva ya lo
// normaliza, no esta función).
const DESCRIPCION_TEXTO_PLANO_CON_MOTIVO = `Programada por
OmegaTest VetOmega
omegavet.test@gmail.com
55-29000090

Nombre de la Mascota
sparky

Motivo de Consulta:
Revision de progreso post gripa

🐾 ¡Estamos felices de recibirte!

Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla. Selecciona el día y horario que mejor te funcione para brindarle la atención que necesita.

Para que tu visita sea lo más cómoda posible, te pedimos considerar lo siguiente:

• Llega al menos 10 minutos antes de la hora programada para realizar el registro con calma.
• Si cuentas con estudios, recetas, cartilla de vacunación o antecedentes médicos, tráelos contigo.
• Por seguridad, los perros deberán asistir con correa y los gatos u otras mascotas pequeñas en transportadora.
• Si no puedes asistir, te agradecemos avisar con anticipación para poder liberar el espacio o ayudarte a reprogramar.
• Algunas consultas pueden presentar pequeños retrasos debido a emergencias o pacientes que requieran atención adicional. Agradecemos mucho tu comprensión.

💙 Gracias por confiar en nosotros para cuidar la salud y bienestar de tu mascota. ¡Te esperamos!

Omega
Hospital Veterinario & Estetica`;

// Pedido explícito del usuario: el mismo Google Calendar puede tener otras
// páginas de reservas (para servicios que no son Consultas) — reconocer
// una reserva ahora exige AMBAS señales: el título del evento (mismo
// campo `summary` que agenda.googleSync.js#pushCita ya llena al empujar
// una cita nuestra) y el texto propio de la descripción de la página de
// Consultas.
const TITULO = 'Consultas Veterinarias';

// Mismo literal que agenda.reservasExternas.js#SENAL_DESCRIPCION (no
// exportado) — se repite aquí solo para armar descripciones mínimas
// válidas en los tests de abajo, no para probar esa constante en sí.
const SENAL_DESCRIPCION_TEXTO =
  'Agenda aquí la cita de tu compañero de cuatro patas de forma rápida y sencilla.';

describe('agenda.reservasExternas.esReservaDeConsultas / extraerDatosReserva', () => {
  it('reconoce un evento real (título "Consultas Veterinarias" + descripción de la página)', () => {
    expect(esReservaDeConsultas(TITULO, DESCRIPCION_TEXTO_PLANO)).toBe(true);
    expect(esReservaDeConsultas(TITULO, DESCRIPCION_HTML_REAL)).toBe(true);
  });

  it('el título se compara sin distinguir mayúsculas/minúsculas y admite texto alrededor (ej. "Cita: Consultas Veterinarias con Juan")', () => {
    expect(esReservaDeConsultas('consultas veterinarias', DESCRIPCION_HTML_REAL)).toBe(true);
    expect(
      esReservaDeConsultas('Cita: Consultas Veterinarias con Juan', DESCRIPCION_HTML_REAL),
    ).toBe(true);
  });

  it('extrae teléfono/mascota/tutor/correo del HTML real que regresa la API (bug real, ver el comentario de arriba)', () => {
    expect(extraerDatosReserva(TITULO, DESCRIPCION_HTML_REAL)).toEqual({
      telefono: '5529000090',
      nombreMascota: 'Sparky',
      nombreTutor: 'OmegaTest VetOmega',
      correo: 'omegavet.test@gmail.com',
      motivoConsulta: null,
    });
  });

  it('extrae igual de bien contra el texto plano equivalente', () => {
    expect(extraerDatosReserva(TITULO, DESCRIPCION_TEXTO_PLANO)).toEqual({
      telefono: '5529000090',
      nombreMascota: 'Sparky',
      nombreTutor: 'OmegaTest VetOmega',
      correo: 'omegavet.test@gmail.com',
      motivoConsulta: null,
    });
  });

  // Pedido explícito del usuario: el "Motivo de Consulta" (pregunta
  // opcional del formulario, igual que "Nombre de la Mascota") se
  // preserva — antes se extraía y se descartaba por completo.
  it('extrae el motivo de consulta cuando el cliente lo contesta (ejemplo real dado por el usuario)', () => {
    expect(extraerDatosReserva(TITULO, DESCRIPCION_TEXTO_PLANO_CON_MOTIVO)).toEqual({
      telefono: '5529000090',
      nombreMascota: 'sparky',
      nombreTutor: 'OmegaTest VetOmega',
      correo: 'omegavet.test@gmail.com',
      motivoConsulta: 'Revision de progreso post gripa',
    });
  });

  // Pedido explícito del usuario: el cliente puede escribir el teléfono en
  // el formulario de Google con o sin separadores — antes solo se
  // reconocían 10 dígitos seguidos, cualquier otro formato dejaba
  // `telefono: null` y la reserva se importaba como caso 3 (sin match)
  // aunque el tutor SÍ estuviera registrado.
  it.each([
    ['5529000090', '5529000090'],
    ['55-2900-0090', '5529000090'],
    ['55 29 00 00 90', '5529000090'],
    ['55 2900 0090', '5529000090'],
  ])('reconoce el teléfono "%s" igual que sin separadores', (telefonoEscrito, esperado) => {
    const descripcion = `Programada por\nGuillermo Trujillo\nguille@correo.com\n${telefonoEscrito}\n\n${SENAL_DESCRIPCION_TEXTO}`;
    expect(extraerDatosReserva(TITULO, descripcion)?.telefono).toBe(esperado);
  });

  it('un teléfono con más o menos de 10 dígitos (aun con el patrón de separadores) no se toma como válido', () => {
    const descripcion = `Programada por\nGuillermo Trujillo\nguille@correo.com\n55-2900-00900\n\n${SENAL_DESCRIPCION_TEXTO}`;
    expect(extraerDatosReserva(TITULO, descripcion)?.telefono).toBeNull();
  });

  it('un evento sin la señal del formulario no se reconoce, regresa null', () => {
    expect(esReservaDeConsultas(TITULO, 'Un evento cualquiera sin nada que ver')).toBe(false);
    expect(extraerDatosReserva(TITULO, 'Un evento cualquiera sin nada que ver')).toBeNull();
    expect(extraerDatosReserva(TITULO, undefined)).toBeNull();
  });

  // Pedido explícito del usuario: sin el título correcto, posiblemente es
  // la sesión de otra página de reservas — no se reconoce aunque la
  // descripción coincida.
  it('con la descripción correcta pero un título de otra página, no se reconoce', () => {
    expect(esReservaDeConsultas('Estética canina', DESCRIPCION_HTML_REAL)).toBe(false);
    expect(esReservaDeConsultas(undefined, DESCRIPCION_HTML_REAL)).toBe(false);
    expect(extraerDatosReserva('Estética canina', DESCRIPCION_HTML_REAL)).toBeNull();
  });

  it('con el título correcto pero sin la descripción de la página de Consultas, no se reconoce', () => {
    expect(esReservaDeConsultas(TITULO, 'Cualquier otra descripción')).toBe(false);
    expect(extraerDatosReserva(TITULO, 'Cualquier otra descripción')).toBeNull();
  });

  it('SÍ reconoce una reserva real sin la pregunta de mascota contestada (bug real, ver el comentario de arriba) — nombreMascota queda null, el resto se extrae bien', () => {
    expect(esReservaDeConsultas(TITULO, DESCRIPCION_HTML_SIN_MASCOTA)).toBe(true);
    expect(extraerDatosReserva(TITULO, DESCRIPCION_HTML_SIN_MASCOTA)).toEqual({
      telefono: '5529000090',
      nombreMascota: null,
      nombreTutor: 'J. Ivan Trujillo M.',
      correo: 'leoivan.moreno@gmail.com',
      motivoConsulta: null,
    });
  });
});

describe('agenda.reservasExternas.resolverReserva', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('caso 1: teléfono y nombre de mascota matchean -> confirmada con propietarioId y mascotaId', async () => {
    tutoresRepository.findByTelefono.mockResolvedValue({ id: 10 });
    tutoresRepository.findMascotasByPropietarioId.mockResolvedValue([
      { id: 100, nombre: 'Sparky' },
      { id: 101, nombre: 'Firulais' },
    ]);

    const resultado = await resolverReserva({ telefono: '5529000090', nombreMascota: 'Sparky' });

    expect(resultado).toEqual({ propietarioId: 10, mascotaId: 100, estado: 'confirmada' });
  });

  it('el match de mascota ignora acentos/mayúsculas/espacios', async () => {
    tutoresRepository.findByTelefono.mockResolvedValue({ id: 10 });
    tutoresRepository.findMascotasByPropietarioId.mockResolvedValue([
      { id: 100, nombre: 'Ñuño  Pérez' },
    ]);

    const resultado = await resolverReserva({
      telefono: '5529000090',
      nombreMascota: 'ñuño perez',
    });

    expect(resultado.mascotaId).toBe(100);
  });

  it('caso 2: teléfono matchea pero el nombre de mascota no -> registrada con propietarioId, sin mascotaId', async () => {
    tutoresRepository.findByTelefono.mockResolvedValue({ id: 10 });
    tutoresRepository.findMascotasByPropietarioId.mockResolvedValue([
      { id: 100, nombre: 'Firulais' },
    ]);

    const resultado = await resolverReserva({ telefono: '5529000090', nombreMascota: 'Sparky' });

    expect(resultado).toEqual({ propietarioId: 10, mascotaId: null, estado: 'registrada' });
  });

  it('caso 2b: teléfono matchea pero no vino nombre de mascota -> registrada con propietarioId, sin mascotaId', async () => {
    tutoresRepository.findByTelefono.mockResolvedValue({ id: 10 });

    const resultado = await resolverReserva({ telefono: '5529000090', nombreMascota: null });

    expect(resultado).toEqual({ propietarioId: 10, mascotaId: null, estado: 'registrada' });
    expect(tutoresRepository.findMascotasByPropietarioId).not.toHaveBeenCalled();
  });

  it('caso 3: el teléfono no matchea ningún tutor -> registrada sin propietarioId ni mascotaId', async () => {
    tutoresRepository.findByTelefono.mockResolvedValue(undefined);

    const resultado = await resolverReserva({ telefono: '5529000090', nombreMascota: 'Sparky' });

    expect(resultado).toEqual({ propietarioId: null, mascotaId: null, estado: 'registrada' });
  });

  it('sin teléfono en la reserva, ni siquiera consulta el repository', async () => {
    const resultado = await resolverReserva({ telefono: null, nombreMascota: 'Sparky' });

    expect(resultado).toEqual({ propietarioId: null, mascotaId: null, estado: 'registrada' });
    expect(tutoresRepository.findByTelefono).not.toHaveBeenCalled();
  });
});

describe('agenda.reservasExternas.importarReserva', () => {
  const EVENTO = {
    id: 'evt-1',
    summary: TITULO,
    description: DESCRIPCION_HTML_REAL,
    start: { dateTime: '2026-09-10T15:00:00.000Z' },
    end: { dateTime: '2026-09-10T15:30:00.000Z' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findByGoogleEventId.mockResolvedValue(undefined);
    areasRepository.findBySlug.mockResolvedValue({ id: 22, slug: 'consultas' });
    repository.obtenerOCrearDoctorConsultasPredeterminado.mockResolvedValue({ id: 87 });
    tutoresRepository.findByTelefono.mockResolvedValue(undefined);
    repository.crearDesdeReservaExterna.mockResolvedValue(999);
  });

  it('un evento que no es una reserva reconocida no llega ni a buscar duplicados', async () => {
    const id = await importarReserva({ id: 'evt-2', description: 'algo sin la señal' });

    expect(id).toBeNull();
    expect(repository.findByGoogleEventId).not.toHaveBeenCalled();
  });

  it('un evento ya importado antes (mismo google_event_id) se ignora', async () => {
    repository.findByGoogleEventId.mockResolvedValue({ id: 5 });

    const id = await importarReserva(EVENTO);

    expect(id).toBeNull();
    expect(repository.crearDesdeReservaExterna).not.toHaveBeenCalled();
  });

  it('crea la cita con area/doctor predeterminados, duración calculada del start/end, y origen reserva_externa', async () => {
    const id = await importarReserva(EVENTO);

    expect(id).toBe(999);
    expect(repository.crearDesdeReservaExterna).toHaveBeenCalledWith(
      expect.objectContaining({
        areaId: 22,
        doctorId: 87,
        duracionMinutos: 30,
        googleEventId: 'evt-1',
        fechaHoraInicio: new Date('2026-09-10T15:00:00.000Z'),
      }),
    );
  });

  it('sin match de teléfono, el motivo queda como texto propio y corto (nunca el bloque de instrucciones completo)', async () => {
    await importarReserva(EVENTO);

    const [args] = repository.crearDesdeReservaExterna.mock.calls[0];
    expect(args.motivo).not.toContain('Estamos felices de recibirte');
    expect(args.motivo).toContain('Sparky');
    expect(args.motivo).toContain('5529000090');
    expect(args.estado).toBe('registrada');
    expect(args.mascotaId).toBeNull();
    expect(args.propietarioId).toBeNull();
  });

  // Pedido explícito del usuario: el motivo de consulta que escribió el
  // cliente (ejemplo real dado por él, con teléfono con guion) se preserva
  // en el `motivo` de la cita creada, no se descarta.
  it('preserva el motivo de consulta del cliente en el motivo de la cita creada', async () => {
    await importarReserva({
      ...EVENTO,
      description: DESCRIPCION_TEXTO_PLANO_CON_MOTIVO,
    });

    const [args] = repository.crearDesdeReservaExterna.mock.calls[0];
    expect(args.motivo).toContain('Revision de progreso post gripa');
  });

  it('si falta el área Consultas o el doctor predeterminado (migración no corrida), no crea nada y no truena', async () => {
    areasRepository.findBySlug.mockResolvedValue(undefined);

    const id = await importarReserva(EVENTO);

    expect(id).toBeNull();
    expect(repository.crearDesdeReservaExterna).not.toHaveBeenCalled();
  });

  it('un evento sin start/end no se importa', async () => {
    const id = await importarReserva({
      id: 'evt-3',
      summary: TITULO,
      description: DESCRIPCION_HTML_REAL,
    });

    expect(id).toBeNull();
    expect(repository.crearDesdeReservaExterna).not.toHaveBeenCalled();
  });

  // Pedido explícito del usuario: título de otra página de reservas
  // (aunque comparta la descripción, poco probable pero mismo criterio) no
  // debe importarse — ni siquiera llega a buscar duplicados.
  it('un evento con la descripción correcta pero el título de otra página no se importa', async () => {
    const id = await importarReserva({
      ...EVENTO,
      id: 'evt-4',
      summary: 'Estética canina',
    });

    expect(id).toBeNull();
    expect(repository.findByGoogleEventId).not.toHaveBeenCalled();
  });

  it('si algo truena a media importación, no se propaga (se loguea, se reintenta el siguiente ciclo)', async () => {
    repository.crearDesdeReservaExterna.mockRejectedValue(new Error('db down'));

    await expect(importarReserva(EVENTO)).resolves.toBeNull();
  });
});
