const {
  validarTransicion,
  ESTADOS_CON_SEGUIMIENTO,
} = require('../../src/modules/whatsapp/whatsapp.estados');

describe('whatsapp.estados.validarTransicion', () => {
  it('acumulando puede quedarse en acumulando (AC6)', () => {
    expect(validarTransicion('acumulando', 'acumulando')).toBe(true);
  });

  it('acumulando y flujo_activo pueden pasar a esperando_menu (AC11)', () => {
    expect(validarTransicion('acumulando', 'esperando_menu')).toBe(true);
    expect(validarTransicion('flujo_activo', 'esperando_menu')).toBe(true);
  });

  it('atencion_humana no puede pasar a esperando_menu (AC12)', () => {
    expect(validarTransicion('atencion_humana', 'esperando_menu')).toBe(false);
  });

  it('cerrada es terminal: no puede volver a acumulando (AC10)', () => {
    expect(validarTransicion('cerrada', 'acumulando')).toBe(false);
  });

  it('cerrada no puede volver a cerrarse (transición inválida, AC18)', () => {
    expect(validarTransicion('cerrada', 'cerrada')).toBe(false);
  });

  it('acumulando puede cerrarse (AC8)', () => {
    expect(validarTransicion('acumulando', 'cerrada')).toBe(true);
  });

  it('acumulando puede pasar a procesando (US WA 003 AC5)', () => {
    expect(validarTransicion('acumulando', 'procesando')).toBe(true);
  });

  it('procesando puede cerrarse (US WA 003 AC14: cierre controlado)', () => {
    expect(validarTransicion('procesando', 'cerrada')).toBe(true);
  });

  it('procesando no puede volver a acumulando', () => {
    expect(validarTransicion('procesando', 'acumulando')).toBe(false);
  });

  it('procesando puede pasar a esperando_menu (US WA 004 AC5)', () => {
    expect(validarTransicion('procesando', 'esperando_menu')).toBe(true);
  });

  it('esperando_menu y flujo_activo pueden cerrarse (US WA 013 AC6)', () => {
    expect(validarTransicion('esperando_menu', 'cerrada')).toBe(true);
    expect(validarTransicion('flujo_activo', 'cerrada')).toBe(true);
  });

  it('ESTADOS_CON_SEGUIMIENTO es exactamente esperando_menu y flujo_activo (US WA 013 AC8)', () => {
    expect(ESTADOS_CON_SEGUIMIENTO.sort()).toEqual(['esperando_menu', 'flujo_activo'].sort());
  });

  it('procesando puede pasar a flujo_activo (US WA 014 AC4)', () => {
    expect(validarTransicion('procesando', 'flujo_activo')).toBe(true);
  });

  it('flujo_activo puede pasar a procesando (US WA 014 AC5)', () => {
    expect(validarTransicion('flujo_activo', 'procesando')).toBe(true);
  });
});
