// Registra en Meta todas las plantillas activas de `plantillas_whatsapp`
// (pedido explícito del usuario, 2026-09-02) — siguen siendo respuestas
// para DENTRO de una conversación ya abierta (WhatsApp no exige
// aprobación de Meta para eso), se registran de todos modos para tener el
// mecanismo de status ya validado (Decisión 24/Bitácora v4 línea 33). NO
// modifica el schema — el registro/consulta de estado se hace en vivo
// contra la API de Meta, sin guardar el estado en la BD todavía.
//
// Uso: pnpm run whatsapp:registrar-plantillas
const db = require('../src/config/database');
const { templatesUrl, authHeaders } = require('../src/config/whatsapp');
const { nombreMeta } = require('../src/modules/plantillas_whatsapp/plantillas_whatsapp.service');

async function main() {
  const plantillas = await db('plantillas_whatsapp')
    .where('activo', true)
    .select('slug', 'intencion', 'texto_respuesta');

  if (plantillas.length === 0) {
    console.error('No hay plantillas activas en la BD.');
    process.exitCode = 1;
    return;
  }

  for (const plantilla of plantillas) {
    const body = {
      name: nombreMeta(plantilla.slug),
      language: 'es_MX',
      // UTILITY, no MARKETING: son respuestas informativas/de servicio al
      // cliente, no promocionales — categoría correcta según las reglas
      // de Meta.
      category: 'UTILITY',
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
