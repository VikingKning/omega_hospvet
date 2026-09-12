// Rediseño del mensaje de WhatsApp de "resultados de laboratorio listos"
// (pedido explícito del usuario: texto más cercano/amigable, con folio,
// links de agendar cita y ubicación, y saludo según la hora del día) —
// una plantilla YA APROBADA por Meta es inmutable en su body/header/footer
// (ver 20260824000002_add_slug_a_plantillas_whatsapp.js: el slug de una
// fila "se fija UNA SOLA VEZ... y nunca vuelve a cambiar"), así que un
// cambio de texto exige una fila NUEVA con un slug NUEVO (nunca reusar ni
// renombrar 'resultados-laboratorio-listos') — la fila vieja se desactiva
// pero NO se borra (es_predeterminada=true la marca inborrable, mismo
// criterio que el resto del catálogo) para no romper el histórico de
// mensajes_whatsapp.plantilla_id ni un envío en curso si hubiera uno.
//
// El slug nuevo, vía nombreMeta() (plantillas_whatsapp.service.js:
// slug.replace(/-/g, '_')), debe coincidir EXACTO con el TEMPLATE_NAME
// nuevo registrado en Meta — actualizado también en
// scripts/registrar-plantilla-resultados-laboratorio.js y
// src/modules/whatsapp/whatsapp.envios.js.
//
// 6 variables posicionales (antes 2): {{1}} tutor, {{2}} mascota, {{3}}
// folio (solo el número, "LAB-" es texto literal), {{4}} link de agendar
// cita (GOOGLE_CALENDAR_MEETING_URL), {{5}} link de ubicación
// (GOOGLE_MAPS_URL), {{6}} saludo según hora (día/tarde/noche).
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
