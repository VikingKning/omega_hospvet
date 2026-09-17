const TEXTO_RESPUESTA =
  'Hola {{1}}, los resultados de laboratorio de {{2}} ya están listos. ' +
  'Puedes consultarlos en el documento adjunto.';

exports.up = async function up(knex) {
  await knex('plantillas_whatsapp').insert({
    intencion: 'default_resultados_laboratorio_listos',
    slug: 'resultados-laboratorio-listos',
    texto_respuesta: TEXTO_RESPUESTA,
    activo: true,
    es_predeterminada: true,
    veces_usada: 0,
    creado_en: knex.fn.now(),
  });
};

exports.down = async function down(knex) {
  await knex('plantillas_whatsapp').where('slug', 'resultados-laboratorio-listos').del();
};
