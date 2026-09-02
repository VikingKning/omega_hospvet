// Consulta en vivo el estado de aprobación de las plantillas dadas de
// alta en Meta (PENDING/APPROVED/REJECTED/...) — parte del mismo
// experimento que registrar-plantillas-whatsapp.js, ver el comentario ahí.
// Corre esto cada rato para ver cuánto tarda Meta en revisar.
//
// Uso: pnpm run whatsapp:estado-plantillas
const { templatesUrl, authHeaders } = require('../src/config/whatsapp');

async function main() {
  const url = `${templatesUrl()}?fields=name,status,category,language,rejected_reason&limit=100`;
  const res = await fetch(url, { headers: authHeaders() });
  const data = await res.json();

  if (!res.ok) {
    console.error(`HTTP ${res.status}`);
    console.error(JSON.stringify(data, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!data.data.length) {
    console.log('Todavía no hay ninguna plantilla registrada en esta cuenta.');
    return;
  }

  console.table(
    data.data.map((t) => ({
      nombre: t.name,
      idioma: t.language,
      categoria: t.category,
      estado: t.status,
      motivo_rechazo: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : '',
    })),
  );
}

main();
