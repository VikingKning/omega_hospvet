const CLAVES_FUNCIONES = Object.freeze({
  LABORATORIO_ENVIO_WHATSAPP: 'laboratorio_envio_whatsapp',
  LABORATORIO_ENVIO_CORREO: 'laboratorio_envio_correo',
  WHATSAPP_RESPUESTAS_AUTOMATICAS: 'whatsapp_respuestas_automaticas',
  WHATSAPP_CITAS_CONSULTAS: 'whatsapp_citas_consultas',
  WHATSAPP_CITAS_ESTETICA: 'whatsapp_citas_estetica',
  WHATSAPP_AVISO_PRIVACIDAD: 'whatsapp_aviso_privacidad',
});

const LISTA_CLAVES_FUNCIONES = Object.freeze(Object.values(CLAVES_FUNCIONES));

module.exports = { CLAVES_FUNCIONES, LISTA_CLAVES_FUNCIONES };
