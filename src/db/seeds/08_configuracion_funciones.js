const FUNCIONES_SISTEMA = [
  {
    clave: 'laboratorio_envio_whatsapp',
    grupo: 'laboratorio',
    nombre: 'Envío de resultados por WhatsApp',
    descripcion: 'Permite enviar resultados de laboratorio por WhatsApp.',
  },
  {
    clave: 'laboratorio_envio_correo',
    grupo: 'laboratorio',
    nombre: 'Envío de resultados por correo',
    descripcion: 'Permite enviar resultados de laboratorio por correo electrónico.',
  },
  {
    clave: 'whatsapp_respuestas_automaticas',
    grupo: 'whatsapp',
    nombre: 'Respuestas automáticas',
    descripcion: 'Permite que el asistente responda automáticamente mensajes entrantes.',
  },
  {
    clave: 'whatsapp_citas_consultas',
    grupo: 'whatsapp',
    nombre: 'Citas de Consultas',
    descripcion: 'Permite ofrecer el flujo de citas para Consultas por WhatsApp.',
  },
  {
    clave: 'whatsapp_citas_estetica',
    grupo: 'whatsapp',
    nombre: 'Citas de Estética',
    descripcion: 'Permite ofrecer el flujo de citas para Estética por WhatsApp.',
  },
  {
    clave: 'whatsapp_aviso_privacidad',
    grupo: 'whatsapp',
    nombre: 'Aviso de privacidad',
    descripcion: 'Permite solicitar el consentimiento de privacidad por WhatsApp.',
  },
];

exports.seed = async function seed(knex) {
  for (const funcion of FUNCIONES_SISTEMA) {
    await knex('configuracion_funciones')
      .insert({ ...funcion, habilitado: true })
      .onConflict('clave')
      .merge({
        grupo: funcion.grupo,
        nombre: funcion.nombre,
        descripcion: funcion.descripcion,
      });
  }
};

exports.FUNCIONES_SISTEMA = FUNCIONES_SISTEMA;
