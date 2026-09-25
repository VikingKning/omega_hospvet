// US WA 004 — normalización/detección pura, sin dependencias de BD ni red.
const menu = require('../../src/modules/whatsapp/whatsapp.menu');

describe('whatsapp.menu.esSaludoPuro', () => {
  it.each(['hola', 'Hola', 'HOLA', 'hola  ', '  hola'])(
    'reconoce un saludo simple (%s) (prueba mínima 1)',
    (texto) => {
      expect(menu.esSaludoPuro(texto)).toBe(true);
    },
  );

  it('reconoce un saludo con signos, mayúsculas y emoji (prueba mínima 2)', () => {
    expect(menu.esSaludoPuro('¡HOLA!! 😀')).toBe(true);
  });

  it.each(['Buen día', 'buenos días', 'Buenas tardes', 'Buenas noches'])(
    'reconoce variantes de "buen día" (%s) (prueba mínima 3)',
    (texto) => {
      expect(menu.esSaludoPuro(texto)).toBe(true);
    },
  );

  it('un saludo seguido de una consulta médica NO es saludo puro (AC3, prueba mínima 4)', () => {
    expect(menu.esSaludoPuro('hola, mi perro no come')).toBe(false);
  });

  it('una consulta de emergencia precedida de un saludo NO es saludo puro (AC4, prueba mínima 5)', () => {
    expect(menu.esSaludoPuro('Hola mi perro está convulsionando')).toBe(false);
  });

  it('un comando de menú no es un saludo', () => {
    expect(menu.esSaludoPuro('menu')).toBe(false);
  });

  it('texto vacío o nulo no es un saludo', () => {
    expect(menu.esSaludoPuro('')).toBe(false);
    expect(menu.esSaludoPuro(null)).toBe(false);
    expect(menu.esSaludoPuro(undefined)).toBe(false);
  });
});

describe('whatsapp.menu.esComandoMenu', () => {
  it.each(['menu', 'Menú', 'MENÚ', 'inicio', 'Inicio', 'ayuda', 'opciones'])(
    'reconoce el comando "%s"',
    (texto) => {
      expect(menu.esComandoMenu(texto)).toBe(true);
    },
  );

  it('un saludo no es un comando de menú', () => {
    expect(menu.esComandoMenu('hola')).toBe(false);
  });

  it('un comando de menú con texto adicional no cuenta (coincidencia exacta)', () => {
    expect(menu.esComandoMenu('menu por favor')).toBe(false);
  });
});

describe('whatsapp.menu.interactivePayload / textoRespaldo', () => {
  it('el payload interactivo es tipo list con filas de id estable', () => {
    const payload = menu.interactivePayload();
    expect(payload.type).toBe('list');
    expect(payload.action.sections[0].rows.length).toBeGreaterThan(0);
    payload.action.sections[0].rows.forEach((fila) => {
      expect(fila.id).toEqual(expect.any(String));
      expect(fila.title).toEqual(expect.any(String));
    });
  });

  it('el respaldo de texto incluye todas las opciones del menú interactivo', () => {
    const payload = menu.interactivePayload();
    const respaldo = menu.textoRespaldo();
    payload.action.sections[0].rows.forEach((fila) => {
      expect(respaldo).toContain(fila.title);
    });
  });

  it('oculta Consultas, Estética y Aviso de privacidad según la configuración', () => {
    const funciones = {
      citasConsultas: false,
      citasEstetica: true,
      avisoPrivacidad: false,
    };
    const filas = menu.interactivePayload(funciones).action.sections[0].rows;
    const ids = filas.map((fila) => fila.id);
    const respaldo = menu.textoRespaldo(funciones);

    expect(ids).not.toContain(menu.MENU_AGENDAR_CONSULTA);
    expect(ids).toContain(menu.MENU_AGENDAR_ESTETICA);
    expect(ids).not.toContain(menu.MENU_AVISO_PRIVACIDAD);
    expect(respaldo).not.toContain('Consulta Veterinaria');
    expect(respaldo).toContain('Cita de Estética');
    expect(respaldo).not.toContain('Aviso de privacidad');
  });

  it('no resuelve rutas de opciones deshabilitadas aunque llegue una respuesta de un menú anterior', () => {
    const funciones = {
      citasConsultas: false,
      citasEstetica: false,
      avisoPrivacidad: false,
    };

    expect(menu.resolverRuta(menu.MENU_AGENDAR_CONSULTA, funciones)).toBeNull();
    expect(menu.resolverRuta(menu.MENU_AGENDAR_ESTETICA, funciones)).toBeNull();
    expect(menu.resolverRuta(menu.MENU_AVISO_PRIVACIDAD, funciones)).toBeNull();
    expect(menu.resolverRuta(menu.MENU_RECEPCION, funciones)).toBe('recepcion');
  });

  // Regresión: Meta rechazó en producción (#131009 "Parameter value is not
  // valid") un footer de 61 caracteres y un row.title de 25 — los límites
  // duros de la Cloud API para interactive/list son 60/24 respectivamente.
  it('respeta los límites de longitud de Meta para interactive/list', () => {
    const payload = menu.interactivePayload();
    expect(payload.header.text.length).toBeLessThanOrEqual(60);
    expect(payload.body.text.length).toBeLessThanOrEqual(1024);
    expect(payload.footer.text.length).toBeLessThanOrEqual(60);
    expect(payload.action.button.length).toBeLessThanOrEqual(20);
    payload.action.sections.forEach((seccion) => {
      expect(seccion.title.length).toBeLessThanOrEqual(24);
      seccion.rows.forEach((fila) => {
        expect(fila.id.length).toBeLessThanOrEqual(200);
        expect(fila.title.length).toBeLessThanOrEqual(24);
        expect(fila.description.length).toBeLessThanOrEqual(72);
      });
    });
  });
});

// US WA 013 — la pregunta de seguimiento (Continuar/Volver al menú).
describe('whatsapp.menu.seguimientoInteractivePayload', () => {
  it('es tipo button con exactamente los 2 botones esperados (consideración técnica)', () => {
    const payload = menu.seguimientoInteractivePayload();
    expect(payload.type).toBe('button');
    const ids = payload.action.buttons.map((b) => b.reply.id);
    expect(ids).toEqual([menu.RESPUESTA_CONTINUAR, menu.RESPUESTA_VOLVER_MENU]);
  });

  it('RESPUESTA_CONTINUAR y RESPUESTA_VOLVER_MENU son identificadores internos estables, no los títulos visibles', () => {
    const payload = menu.seguimientoInteractivePayload();
    payload.action.buttons.forEach((boton) => {
      expect(boton.reply.id).not.toBe(boton.reply.title);
    });
  });
});

// US WA 005 — menú con las 6 opciones exactas de AC1 (5 + LFPDPPP) y el
// mapeo id -> ruta.
describe('whatsapp.menu — opciones del menú y resolución de ruta (US WA 005)', () => {
  it('el menú tiene exactamente los 6 títulos de AC1, en orden', () => {
    const filas = menu.interactivePayload().action.sections[0].rows;
    expect(filas.map((f) => f.title)).toEqual([
      'Consulta Veterinaria',
      'Cita de Estética',
      'Resultado de laboratorio',
      'Emergencia',
      'Recepción',
      'Aviso de privacidad',
    ]);
  });

  it('cada fila usa una de las 6 constantes MENU_* como id, nunca el título', () => {
    const filas = menu.interactivePayload().action.sections[0].rows;
    const ids = filas.map((f) => f.id);
    expect(ids).toEqual([
      menu.MENU_AGENDAR_CONSULTA,
      menu.MENU_AGENDAR_ESTETICA,
      menu.MENU_RESULTADOS_LAB,
      menu.MENU_EMERGENCIA,
      menu.MENU_RECEPCION,
      menu.MENU_AVISO_PRIVACIDAD,
    ]);
  });

  it.each([
    ['MENU_AGENDAR_CONSULTA', 'agendar_consulta'],
    ['MENU_AGENDAR_ESTETICA', 'agendar_estetica'],
    ['MENU_RESULTADOS_LAB', 'resultados_laboratorio'],
    ['MENU_EMERGENCIA', 'emergencia'],
    ['MENU_RECEPCION', 'recepcion'],
    ['MENU_AVISO_PRIVACIDAD', 'ver_aviso_privacidad'],
  ])(
    'RUTA_POR_MENU_ID[%s] resuelve a "%s" (AC3-AC7, prueba mínima: cada id válido)',
    (clave, ruta) => {
      expect(menu.RUTA_POR_MENU_ID[menu[clave]]).toBe(ruta);
    },
  );

  it('esIdDeMenu reconoce los 6 ids válidos y rechaza cualquier otro (prueba mínima: id desconocido o manipulado)', () => {
    expect(menu.esIdDeMenu(menu.MENU_AGENDAR_CONSULTA)).toBe(true);
    expect(menu.esIdDeMenu(menu.MENU_RECEPCION)).toBe(true);
    expect(menu.esIdDeMenu(menu.MENU_AVISO_PRIVACIDAD)).toBe(true);
    expect(menu.esIdDeMenu('MENU_INVENTADO')).toBe(false);
    expect(menu.esIdDeMenu('')).toBe(false);
    expect(menu.esIdDeMenu(undefined)).toBe(false);
  });

  it('textoOpcionInvalida devuelve un texto no vacío (AC9)', () => {
    expect(typeof menu.textoOpcionInvalida()).toBe('string');
    expect(menu.textoOpcionInvalida().length).toBeGreaterThan(0);
  });
});
