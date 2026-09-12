// Registra en Meta las plantillas activas de `plantillas_whatsapp` que
// TODAVÍA NO están aprobadas Y que tienen una categoría REAL de Meta
// (pedido explícito del usuario, 2026-09-02; filtros de aprobado_meta y
// categoria_meta agregados 2026-09-12). Decisión explícita del usuario:
// de todo el catálogo, solo la plantilla de resultados de laboratorio de
// verdad necesita ser una plantilla aprobada por Meta (la única que
// INICIA el negocio, sin importar si el cliente escribió antes, y esa ya
// tiene su propio script — ver la exclusión de abajo). Todas las demás
// son 'TEXTO_LIBRE': respuestas DENTRO de una conversación que el cliente
// ya abrió (whatsapp.service.js#enviarRespuesta manda type:'text', nunca
// type:'template' — no necesitan ni deben registrarse en Meta, hacerlo
// solo duplicaría plantillas sin ningún beneficio funcional). Este script
// ya casi nunca debería encontrar algo que registrar en el uso normal —
// sigue existiendo para el día que se dé de alta una plantilla real de
// Marketing/Utility/Authentication (mercadotecnia, por ejemplo).
//
// aprobado_meta=false cubre tanto "nunca se registró" como "está PENDING
// en Meta" — ambos casos deben reintentarse; solo una fila ya aprobada
// debe quedar afuera.
//
// Uso: pnpm run whatsapp:registrar-plantillas
const db = require('../src/config/database');
const { templatesUrl, authHeaders } = require('../src/config/whatsapp');
const {
  nombreMeta,
  CATEGORIA_TEXTO_LIBRE,
} = require('../src/modules/plantillas_whatsapp/plantillas_whatsapp.service');

// 'resultados-laboratorio-listos-v2' se excluye a propósito: necesita un
// encabezado de DOCUMENT (el PDF/imagen real de cada envío) que esta
// registración de solo-texto no sabe construir — registrarla aquí primero
// "ganaría" el nombre en Meta sin encabezado, y
// scripts/registrar-plantilla-resultados-laboratorio.js (la que sí arma el
// encabezado, vía Resumable Upload API) ya no podría crearla. Ver esa
// migración/script para el registro real de esta plantilla. (v2, 2026-09-11:
// la fila vieja 'resultados-laboratorio-listos' ya quedó `activo=false`,
// así que ya no necesita estar en esta exclusión, pero no está de más).
const SLUG_EXCLUIDO_DOCUMENTO = 'resultados-laboratorio-listos-v2';

async function main() {
  const plantillas = await db('plantillas_whatsapp')
    .where('activo', true)
    .where('aprobado_meta', false)
    .whereNot('categoria_meta', CATEGORIA_TEXTO_LIBRE)
    .whereNot('slug', SLUG_EXCLUIDO_DOCUMENTO)
    .select('slug', 'intencion', 'texto_respuesta', 'categoria_meta');

  if (plantillas.length === 0) {
    console.log(
      'No hay plantillas pendientes de registrar — todas las activas ya están aprobadas en Meta, o son de texto libre y no necesitan registrarse.',
    );
    return;
  }

  for (const plantilla of plantillas) {
    const body = {
      name: nombreMeta(plantilla.slug),
      language: 'es_MX',
      category: plantilla.categoria_meta,
      components: [{ type: 'BODY', text: plantilla.texto_respuesta }],
    };

    try {
      const res = await fetch(templatesUrl(), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      console.log(`\n${plantilla.slug} (${plantilla.intencion}) -> HTTP ${res.status}`);
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`\n${plantilla.slug} -> error de red:`, err.message);
    }
  }

  await db.destroy();
}

main();
