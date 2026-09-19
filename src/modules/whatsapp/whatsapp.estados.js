const TRANSICIONES = {
  acumulando: ['acumulando', 'esperando_menu', 'cerrada', 'procesando', 'atencion_humana'],
  procesando: ['cerrada', 'esperando_menu', 'flujo_activo', 'atencion_humana'],
  esperando_menu: ['esperando_menu', 'cerrada', 'procesando', 'flujo_activo', 'atencion_humana'],
  flujo_activo: ['flujo_activo', 'esperando_menu', 'cerrada', 'procesando', 'atencion_humana'],
  atencion_humana: ['atencion_humana', 'cerrada'],
  cerrada: [],
};

const ESTADOS_CON_SEGUIMIENTO = ['esperando_menu', 'flujo_activo'];

function validarTransicion(estadoActual, estadoNuevo) {
  return Boolean(TRANSICIONES[estadoActual]?.includes(estadoNuevo));
}

module.exports = { TRANSICIONES, validarTransicion, ESTADOS_CON_SEGUIMIENTO };
