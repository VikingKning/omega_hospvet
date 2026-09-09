// 5ta plantilla "del sistema" (pedido explícito del usuario, mismo patrón
// que las 4 de la migración 20260903000002 — es_predeterminada=true,
// inborrable) — a diferencia de esas 4 (auto-respuesta DENTRO de una
// conversación ya abierta, elegidas por categoria_clasificacion), esta es
// el texto de la plantilla de WhatsApp que avisa que un resultado de
// laboratorio YA ESTÁ LISTO (envío proactivo, fuera de cualquier
// conversación — ver laboratorio.service.js#enviarResultados).
//
// El `slug` NO es cosmético aquí: nombreMeta(slug) debe coincidir EXACTO
// con el nombre real de la plantilla ya registrada en Meta
// (scripts/registrar-plantilla-resultados-laboratorio.js#TEMPLATE_NAME =
// 'resultados_laboratorio_listos') para que plantillas_whatsapp.metaSync.js
// (el job que revisa aprobaciones) reconozca esta fila como esa misma
// plantilla y actualice `aprobado_meta` sola — mismo criterio que las
// demás filas de este catálogo.
//
// A propósito NO se registra aquí en Meta (a diferencia de un alta normal
// vía plantillas_whatsapp.service.js#crear, que sí hace un push
// best-effort): esta plantilla necesita un encabezado de documento (el
// PDF/imagen real de cada envío) que scripts/registrar-plantillas-
// whatsapp.js no sabe construir (solo arma plantillas de puro texto) — el
// registro real en Meta lo hace scripts/registrar-plantilla-resultados-
// laboratorio.js, corrido a mano una sola vez, leyendo el texto_respuesta
// de ESTA fila como fuente de verdad (en vez de tener el texto duplicado
// y hardcodeado en el script).
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
