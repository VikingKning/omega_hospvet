// Registra en Meta la plantilla 'resultados_laboratorio_listos' (envío
// real de resultados de laboratorio, pedido explícito del usuario) —
// ejecución ÚNICA y manual, a diferencia de registrar-plantillas-
// whatsapp.js (esa corre sobre TODAS las plantillas activas de la tabla
// `plantillas_whatsapp`, esta es una sola, fija, con un encabezado de
// documento que esa tabla no modela).
//
// A diferencia de una plantilla de solo texto, un encabezado de tipo
// DOCUMENT exige darle a Meta un archivo de EJEMPLO al momento de crear la
// plantilla (para su revisión) — eso requiere el Resumable Upload API
// (3 pasos: crear sesión, subir el binario, obtener un "header_handle"),
// un flujo sin precedente en este proyecto, documentado paso a paso abajo.
// El PDF real de cada envío NO se sube aquí — eso lo hace whatsapp.envios.js
// en cada envío real, referenciando esta plantilla ya aprobada por su
// nombre.
//
// El texto del BODY se lee de `plantillas_whatsapp` (slug
// 'resultados-laboratorio-listos', migración
// 20260903000004_agregar_plantilla_resultados_laboratorio_listos.js) en
// vez de vivir hardcodeado aquí — pedido explícito del usuario: esa fila
// es la fuente de verdad editable desde el catálogo de Plantillas, este
// script solo la lee al momento de registrar/re-registrar en Meta. El
// slug de esa fila NO es cosmético: nombreMeta(slug) debe coincidir exacto
// con TEMPLATE_NAME de abajo para que plantillas_whatsapp.metaSync.js
// (el job que revisa aprobaciones) la reconozca como la misma plantilla.
//
// Uso: pnpm run whatsapp:registrar-plantilla-resultados
const { PDFDocument, StandardFonts } = require('pdf-lib');
const env = require('../src/config/env');
const db = require('../src/config/database');
const { templatesUrl, authHeaders, GRAPH_API_VERSION } = require('../src/config/whatsapp');

const TEMPLATE_NAME = 'resultados_laboratorio_listos';
const TEMPLATE_LANGUAGE = 'es_MX';
const SLUG = 'resultados-laboratorio-listos';

async function generarPdfDeEjemplo() {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([300, 150]);
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  pagina.drawText('Ejemplo — resultados de laboratorio', { x: 20, y: 100, size: 12, font: fuente });
  return Buffer.from(await pdf.save());
}

// Paso 1: abrir una sesión de subida — regresa un id con el formato
// "upload:<...>", que se vuelve a mandar completo como parte de la URL del
// paso 2 (Meta lo trata como un solo identificador opaco).
async function crearSesionDeSubida(appId, buffer) {
  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${appId}/uploads` +
    `?file_length=${buffer.length}&file_type=application/pdf&file_name=ejemplo-resultados.pdf`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `OAuth ${env.whatsapp.token}` },
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(
      `No se pudo crear la sesión de subida: HTTP ${res.status} — ${JSON.stringify(data)}`,
    );
  }
  return data.id;
}

// Paso 2: subir el binario completo de una sola vez (file_offset: 0) —
// regresa el header_handle ("h") que el paso 3 referencia en `example`.
async function subirArchivo(sessionId, buffer) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${env.whatsapp.token}`,
      file_offset: '0',
    },
    body: buffer,
  });
  const data = await res.json();
  if (!res.ok || !data.h) {
    throw new Error(
      `No se pudo subir el archivo de ejemplo: HTTP ${res.status} — ${JSON.stringify(data)}`,
    );
  }
  return data.h;
}

// Paso 3: crear la plantilla en sí, referenciando el header_handle del
// paso 2 como el "ejemplo" que Meta revisa manualmente.
async function crearPlantilla(headerHandle, bodyText) {
  const body = {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: 'UTILITY',
    components: [
      {
        type: 'HEADER',
        format: 'DOCUMENT',
        example: { header_handle: [headerHandle] },
      },
      {
        type: 'BODY',
        text: bodyText,
        example: { body_text: [['Juan Pérez', 'Firulais']] },
      },
      {
        type: 'FOOTER',
        text: 'Omega Veterinaria & Estética',
      },
    ],
  };

  const res = await fetch(templatesUrl(), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return { res, data: await res.json() };
}

async function main() {
  if (!env.whatsapp.appId) {
    console.error('Falta WHATSAPP_APP_ID en el entorno (ver .env.example).');
    process.exitCode = 1;
    return;
  }

  const plantilla = await db('plantillas_whatsapp').where({ slug: SLUG }).first();
  if (!plantilla || !plantilla.activo) {
    console.error(
      `No se encontró la plantilla activa "${SLUG}" en plantillas_whatsapp — corre las migraciones (pnpm run migrate:localhost) o revisa que no esté desactivada.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Generando PDF de ejemplo...');
  const buffer = await generarPdfDeEjemplo();

  console.log('Abriendo sesión de subida (Resumable Upload API)...');
  const sessionId = await crearSesionDeSubida(env.whatsapp.appId, buffer);

  console.log('Subiendo el archivo de ejemplo...');
  const headerHandle = await subirArchivo(sessionId, buffer);

  console.log(`Creando la plantilla "${TEMPLATE_NAME}"...`);
  const { res, data } = await crearPlantilla(headerHandle, plantilla.texto_respuesta);

  console.log(`\nHTTP ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
