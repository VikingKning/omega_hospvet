const menu = require('./whatsapp.menu');

// US WA 011: catálogo cerrado y precedencia única para los grupos que sí
// alcanzan el worker. Atención humana e interacciones se consumen antes de
// agrupar (en la transacción del webhook) para conservar el silencio y la
// respuesta inmediata; estas rutas permanecen en el catálogo para que la
// auditoría use el mismo vocabulario en todo el módulo.
const RUTAS_ENRUTAMIENTO = Object.freeze({
  ATENCION_HUMANA: 'atencion_humana',
  RESPUESTA_INTERACTIVA: 'respuesta_interactiva',
  COMANDO_MENU: 'comando_menu',
  MEDIO_SIN_TEXTO: 'medio_sin_texto',
  FLUJO_ACTIVO: 'flujo_activo',
  SALUDO_PURO: 'saludo_puro',
  CONSULTA_LIBRE: 'consulta_libre',
});

function seleccionarRutaGrupo({ contexto, grupo }) {
  // Las dos primeras condiciones son defensivas. El registro transaccional
  // del webhook debe impedir que esos mensajes formen un grupo, pero si una
  // fila heredada o recuperada llega aquí se conserva la precedencia formal.
  if (contexto?.estado === 'atencion_humana') {
    return RUTAS_ENRUTAMIENTO.ATENCION_HUMANA;
  }
  if (grupo.tieneRespuestaInteractiva) {
    return RUTAS_ENRUTAMIENTO.RESPUESTA_INTERACTIVA;
  }
  if (grupo.tieneTextoProcesable && menu.esComandoMenu(grupo.texto_consolidado)) {
    return RUTAS_ENRUTAMIENTO.COMANDO_MENU;
  }
  if (!grupo.tieneTextoProcesable) {
    return RUTAS_ENRUTAMIENTO.MEDIO_SIN_TEXTO;
  }
  if (contexto?.flujoActual && contexto?.pasoActual) {
    return RUTAS_ENRUTAMIENTO.FLUJO_ACTIVO;
  }
  if (menu.esSaludoPuro(grupo.texto_consolidado)) {
    return RUTAS_ENRUTAMIENTO.SALUDO_PURO;
  }
  return RUTAS_ENRUTAMIENTO.CONSULTA_LIBRE;
}

module.exports = { RUTAS_ENRUTAMIENTO, seleccionarRutaGrupo };
