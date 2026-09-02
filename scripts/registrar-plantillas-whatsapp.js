// Experimento (pedido explícito del usuario, 2026-09-02): registrar en
// Meta 3 de las plantillas reales que ya existen en `plantillas_whatsapp`,
// para validar el tiempo de aprobación real antes de construir el
// mecanismo definitivo (clasificador de intención con claude-haiku-4-5,
// Decisión 24/Bitácora v4 línea 33 — "solo clasifica en 4 rutas fijas,
// nunca genera contenido médico libre"). NO modifica el schema — el
// registro/consulta de estado se hace en vivo contra la API de Meta, sin
// guardar el estado en la BD todavía (eso es parte del mecanismo
// definitivo, aún sin diseñar).
//
// Uso: pnpm run whatsapp:registrar-plantillas
//
// Nota importante: estas 3 son respuestas para DENTRO de una conversación
// ya abierta (WhatsApp no exige aprobación de Meta para eso) — se
// registran de todos modos, solo para el experimento de validar tiempos y
// el mecanismo de status, no porque las necesiten para su uso real.
const db = require('../src/config/database');
const { templatesUrl, authHeaders } = require('../src/config/whatsapp');

// Las 3 elegidas por el usuario, de las 9 activas en `plantillas_whatsapp`
// hoy — el `slug`/`intencion` de cada una ya viene en formato snake_case,
// coincide con lo que Meta exige para el nombre de una plantilla
// (minúsculas, números y guion bajo únicamente).
const SLUGS_A_REGISTRAR = ['cambio-horario-medicacion', 'dosis-olvidada', 'revision-herida-foto'];

async function main() {
  const plantillas = await db('plantillas_whatsapp')
    .whereIn('slug', SLUGS_A_REGISTRAR)
    .select('slug', 'intencion', 'texto_respuesta');

  if (plantillas.length !== SLUGS_A_REGISTRAR.length) {
    const encontrados = plantillas.map((p) => p.slug);
    const faltantes = SLUGS_A_REGISTRAR.filter((s) => !encontrados.includes(s));
    console.error(`No se encontraron en la BD: ${faltantes.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  for (const plantilla of plantillas) {
    const body = {
      name: plantilla.intencion,
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
