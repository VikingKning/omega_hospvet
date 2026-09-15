const {
  RUTAS_ENRUTAMIENTO,
  seleccionarRutaGrupo,
} = require('../../src/modules/whatsapp/whatsapp.router');

function grupo(texto, extras = {}) {
  return {
    texto_consolidado: texto,
    tieneTextoProcesable: texto.length > 0,
    tieneRespuestaInteractiva: false,
    ...extras,
  };
}

describe('whatsapp.router — precedencia determinista (US WA 011)', () => {
  it('aplica atención humana antes que cualquier contenido', () => {
    expect(
      seleccionarRutaGrupo({
        contexto: { estado: 'atencion_humana', flujoActual: 'emergencia' },
        grupo: grupo('mi mascota no respira', { tieneRespuestaInteractiva: true }),
      }),
    ).toBe(RUTAS_ENRUTAMIENTO.ATENCION_HUMANA);
  });

  it('aplica respuesta interactiva antes que comando o flujo', () => {
    expect(
      seleccionarRutaGrupo({
        contexto: { estado: 'procesando', flujoActual: 'emergencia', pasoActual: 'esperando' },
        grupo: grupo('MENU_EMERGENCIA', { tieneRespuestaInteractiva: true }),
      }),
    ).toBe(RUTAS_ENRUTAMIENTO.RESPUESTA_INTERACTIVA);
  });

  it('aplica comando de menú antes que medio o flujo activo', () => {
    expect(
      seleccionarRutaGrupo({
        contexto: { estado: 'procesando', flujoActual: 'emergencia', pasoActual: 'esperando' },
        grupo: grupo('MENÚ'),
      }),
    ).toBe(RUTAS_ENRUTAMIENTO.COMANDO_MENU);
  });

  it('aplica medio sin texto antes que un flujo activo', () => {
    expect(
      seleccionarRutaGrupo({
        contexto: {
          estado: 'procesando',
          flujoActual: 'consulta_laboratorio',
          pasoActual: 'folio',
        },
        grupo: grupo(''),
      }),
    ).toBe(RUTAS_ENRUTAMIENTO.MEDIO_SIN_TEXTO);
  });

  it('aplica el contrato del flujo antes que saludo puro', () => {
    expect(
      seleccionarRutaGrupo({
        contexto: {
          estado: 'procesando',
          flujoActual: 'emergencia',
          pasoActual: 'esperando_descripcion',
        },
        grupo: grupo('hola'),
      }),
    ).toBe(RUTAS_ENRUTAMIENTO.FLUJO_ACTIVO);
  });

  it('distingue saludo puro de saludo acompañado por una consulta', () => {
    expect(seleccionarRutaGrupo({ contexto: { estado: 'procesando' }, grupo: grupo('hola') })).toBe(
      RUTAS_ENRUTAMIENTO.SALUDO_PURO,
    );
    expect(
      seleccionarRutaGrupo({
        contexto: { estado: 'procesando' },
        grupo: grupo('hola, mi perro no quiere comer'),
      }),
    ).toBe(RUTAS_ENRUTAMIENTO.CONSULTA_LIBRE);
  });
});
