// US WA 006: enlaces públicos de reservación enviados desde el menú de
// WhatsApp. Son distintos de GOOGLE_CALENDAR_ID: este último identifica el
// calendario privado usado por la sincronización, no una página pública.
const env = require('./env');

const CONFIGURACION_POR_RUTA = {
  agendar_consulta: {
    tipoCita: 'Consulta',
    variable: 'GOOGLE_CALENDAR_MEETING_URL',
    obtenerValor: () => env.enlaces.calendarioCitas,
  },
  agendar_estetica: {
    tipoCita: 'Estética',
    variable: 'GOOGLE_CALENDAR_GROOMING',
    obtenerValor: () => env.enlaces.calendarioEstetica,
  },
};

function validarUrlHttps(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const url = valor.trim();
  try {
    const interpretada = new URL(url);
    if (interpretada.protocol !== 'https:' || !interpretada.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function obtenerConfiguracionRuta(ruta) {
  const configuracion = CONFIGURACION_POR_RUTA[ruta];
  if (!configuracion) return null;
  const valorConfigurado = configuracion.obtenerValor();
  const url = validarUrlHttps(valorConfigurado);
  const tieneValor = typeof valorConfigurado === 'string' && Boolean(valorConfigurado.trim());
  return {
    tipoCita: configuracion.tipoCita,
    variable: configuracion.variable,
    url,
    estado: url ? 'valida' : tieneValor ? 'invalida' : 'ausente',
  };
}

function construirTextoEnlace(tipoCita, url) {
  return `Agenda tu cita de ${tipoCita} en el calendario de Omega:\n${url}`;
}

// Se llama al iniciar el servidor. Solo registra el nombre y el estado de
// cada variable; nunca incluye la URL completa en los logs.
function validarConfiguracionAlArrancar(logger) {
  for (const ruta of Object.keys(CONFIGURACION_POR_RUTA)) {
    const configuracion = obtenerConfiguracionRuta(ruta);
    if (configuracion.estado === 'valida') continue;
    logger.warn(
      { variable: configuracion.variable, estado: configuracion.estado },
      'Enlace de agenda de WhatsApp no disponible; la ruta se transferirá a Recepción.',
    );
  }
}

module.exports = {
  validarUrlHttps,
  obtenerConfiguracionRuta,
  construirTextoEnlace,
  validarConfiguracionAlArrancar,
};
