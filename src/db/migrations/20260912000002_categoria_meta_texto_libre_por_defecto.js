// Decisión explícita del usuario (2026-09-12): de las plantillas de
// WhatsApp, la ÚNICA que de verdad necesita ser una plantilla aprobada por
// Meta es la de resultados de laboratorio (se manda vía el botón "Enviar
// resultados", iniciada por el negocio, no por el cliente — WhatsApp exige
// una plantilla aprobada para eso). Todas las demás son respuestas
// automáticas DENTRO de una conversación que el cliente ya abrió (mensaje
// de texto libre, whatsapp.service.js#enviarRespuesta manda type:'text',
// nunca type:'template') — no necesitan registrarse en Meta para
// funcionar, y no registrarlas evita duplicar plantillas y darle a Meta
// contenido de "servicio" disfrazado de plantilla sin necesidad.
//
// 'TEXTO_LIBRE' es un valor propio de este sistema (no existe en la API de
// Meta) que marca una plantilla como "nunca se manda a registro, ni se
// sincroniza su estado/categoría desde Meta" — ver
// plantillas_whatsapp.service.js#crear y
// plantillas_whatsapp.metaSync.js#sincronizarDatosMeta.
const SLUGS_REGISTRADAS_EN_META = [
  'resultados-laboratorio-listos',
  'resultados-laboratorio-listos-v2',
];

exports.up = async function up(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.string('categoria_meta', 20).notNullable().defaultTo('TEXTO_LIBRE').alter();
  });
  await knex('plantillas_whatsapp')
    .whereNotIn('slug', SLUGS_REGISTRADAS_EN_META)
    .update({ categoria_meta: 'TEXTO_LIBRE' });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('plantillas_whatsapp', (table) => {
    table.string('categoria_meta', 20).notNullable().defaultTo('UTILITY').alter();
  });
  // No se revierte el backfill: no hay forma de saber qué categoría real
  // tenía cada fila antes de este cambio (varias sí llegaron a registrarse
  // y aprobarse en Meta en su momento, con categorías reales distintas).
};
