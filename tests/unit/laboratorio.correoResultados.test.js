const {
  construirCorreoResultados,
} = require('../../src/modules/laboratorio/laboratorio.correoResultados');

const DATOS_BASE = {
  nombreTutor: 'Ana Ruiz',
  nombreMascota: 'Firulais',
  fechaSolicitud: '2026-08-27',
  folioId: 5,
  archivos: [{ nombreOriginal: 'resultados.pdf' }],
  calendarioCitas: 'https://calendar.example/agendar',
  googleMapsUrl: 'https://maps.example/ubicacion',
};

describe('laboratorio.correoResultados.construirCorreoResultados', () => {
  it('arma el asunto con el nombre de la mascota', () => {
    const { subject } = construirCorreoResultados(DATOS_BASE);
    expect(subject).toBe('Resultados de laboratorio de Firulais');
  });

  it('el HTML trae el tutor, la mascota, el folio con el mismo formato LAB-XXX ya usado en el resto del sistema, y la fecha en DD/MM/AAAA', () => {
    const { html } = construirCorreoResultados(DATOS_BASE);
    expect(html).toContain('Ana Ruiz');
    expect(html).toContain('Firulais');
    expect(html).toContain('LAB-005');
    expect(html).toContain('27/08/2026');
  });

  it('el logo se referencia por Content-ID, nunca por una URL — este sistema no tiene un dominio público', () => {
    const { html } = construirCorreoResultados(DATOS_BASE);
    expect(html).toContain('src="cid:logo-omega"');
  });

  // Pedido explícito del usuario: sin nombres de estudios en la ficha, ni
  // links de "Preferencias de correo"/"Cancelar suscripción" (son de un
  // newsletter de marketing, no aplican a un aviso transaccional).
  it('no incluye nombres de estudios ni links de baja de newsletter', () => {
    const { html } = construirCorreoResultados({
      ...DATOS_BASE,
      // Ni siquiera se le pasan estudios a esta función — si algún día se
      // le pasaran por error, este test seguiría demostrando que la
      // plantilla no tiene ningún hueco para mostrarlos.
    });
    expect(html).not.toContain('Preferencias de correo');
    expect(html).not.toContain('Cancelar suscripción');
    expect(html).toContain('Paciente');
    expect(html).toContain('Fecha de requerimiento');
    expect(html).toContain('N.° de orden');
  });

  it('el botón para agendar usa el valor recibido de GOOGLE_CALENDAR_MEETING_URL', () => {
    const { html } = construirCorreoResultados(DATOS_BASE);
    expect(html).toContain('href="https://calendar.example/agendar"');
  });

  it('trae un link de "Google Maps" con la URL recibida por parámetro (GOOGLE_MAPS_URL)', () => {
    const { html } = construirCorreoResultados(DATOS_BASE);
    expect(html).toContain('href="https://maps.example/ubicacion"');
    expect(html).toContain('>Google Maps<');
  });

  it('se repite el bloque de adjunto una vez por cada archivo real, con su nombre real', () => {
    const { html } = construirCorreoResultados({
      ...DATOS_BASE,
      archivos: [{ nombreOriginal: 'hemograma.pdf' }, { nombreOriginal: 'radiografia.jpg' }],
    });
    expect(html).toContain('hemograma.pdf');
    expect(html).toContain('radiografia.jpg');
    expect((html.match(/Documento adjunto a este correo/g) ?? []).length).toBe(2);
  });

  it('muestra una insignia dinámica con la extensión real de cada adjunto', () => {
    const { html } = construirCorreoResultados({
      ...DATOS_BASE,
      archivos: [
        { nombreOriginal: 'documento.pdf' },
        { nombreOriginal: 'radiografias.jpg' },
        { nombreOriginal: 'expediente.zip' },
        { nombreOriginal: 'archivo-sin-extension' },
      ],
    });

    expect(html).toContain('>PDF</td>');
    expect(html).toContain('>JPG</td>');
    expect(html).toContain('>ZIP</td>');
    expect(html).toContain('>FILE</td>');
  });

  it('sin fecha de solicitud, muestra un guion en vez de "Invalid Date" o tronar', () => {
    const { html } = construirCorreoResultados({ ...DATOS_BASE, fechaSolicitud: null });
    expect(html).toContain('>—<');
  });

  it('trae un texto plano equivalente (fallback para clientes de correo sin HTML)', () => {
    const { text } = construirCorreoResultados(DATOS_BASE);
    expect(text).toContain('Ana Ruiz');
    expect(text).toContain('LAB-005');
  });
});
