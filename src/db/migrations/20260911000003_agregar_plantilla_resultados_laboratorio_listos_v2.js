const TEXTO_RESPUESTA =
  'Hola, *{{1}}* 👋\n\n' +
  'Los resultados de laboratorio de 🐾 *{{2}}* 🐾, con folio *LAB-{{3}}*, ya están disponibles.\n\n' +
  'Te los enviamos adjuntos a este mensaje para que puedas consultarlos.\n\n' +
  'Si tienes alguna duda sobre los resultados, puedes agendar una cita aquí: {{4}}\n\n' +
  'o acudir a nuestra sucursal para su revisión e interpretación: {{5}}\n\n' +
  'Que tengas un excelente *{{6}}*. 👍';

const SLUG_VIEJO = 'resultados-laboratorio-listos';
const SLUG_NUEVO = 'resultados-laboratorio-listos-v2';

exports.up = async function up(knex) {
  await knex('plantillas_whatsapp').where({ slug: SLUG_VIEJO }).update({ activo: false });

  await knex('plantillas_whatsapp').insert({
    intencion: 'default_resultados_laboratorio_listos_v2',
    slug: SLUG_NUEVO,
    texto_respuesta: TEXTO_RESPUESTA,
    activo: true,
    es_predeterminada: true,
    veces_usada: 0,
    creado_en: knex.fn.now(),
  });
};

exports.down = async function down(knex) {
  await knex('plantillas_whatsapp').where({ slug: SLUG_NUEVO }).del();
  await knex('plantillas_whatsapp').where({ slug: SLUG_VIEJO }).update({ activo: true });
};
