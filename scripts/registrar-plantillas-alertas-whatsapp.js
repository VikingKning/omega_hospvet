// Registro manual de las dos plantillas internas requeridas por US WA 018.
// Se mantienen separadas de plantillas_whatsapp porque no son respuestas
// al tutor ni contenido configurable: son avisos operativos mínimos para
// el personal de Omega.
const { templatesUrl, authHeaders } = require('../src/config/whatsapp');
const { PLANTILLA_META_POR_TIPO } = require('../src/modules/whatsapp/whatsapp.alertas.service');

const TEXTO_POR_TIPO = {
  emergencia:
    'Alerta Omega: una conversación de WhatsApp requiere atención médica urgente. Tutor: {{1}}. Ingresa al portal para atenderla.',
  recepcion:
    'Alerta Omega: una conversación de WhatsApp requiere atención de Recepción. Tutor: {{1}}. Ingresa al portal para atenderla.',
};

async function registrar(tipo) {
  const body = {
    name: PLANTILLA_META_POR_TIPO[tipo],
    language: 'es_MX',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: TEXTO_POR_TIPO[tipo],
        example: { body_text: [['525500001234']] },
      },
      { type: 'FOOTER', text: 'Omega Hospital Veterinario' },
    ],
  };
  const respuesta = await fetch(templatesUrl(), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const resultado = await respuesta.json();
  console.log(`${body.name} -> HTTP ${respuesta.status}`);
  console.log(JSON.stringify(resultado, null, 2));
  if (!respuesta.ok) process.exitCode = 1;
}

async function main() {
  await registrar('emergencia');
  await registrar('recepcion');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
