// Solo lectura: no registra, modifica ni sincroniza plantillas.
// node --env-file="C:\ProgramData\OmegaVet\.env.production" scripts/diagnosticar-plantilla-resultados.js
const whatsapp = require('../src/config/whatsapp');
const { diagnosticoMeta } = require('../src/modules/whatsapp/whatsapp.errores');

const NOMBRE = 'resultados_laboratorio_listos_v2';
const IDIOMA = 'es_MX';

async function diagnosticarPlantillaResultados(fetchImpl = fetch) {
  const url = new URL(whatsapp.templatesUrl());
  url.searchParams.set('name', NOMBRE);
  url.searchParams.set('fields', 'id,name,status,language,category,rejected_reason');
  url.searchParams.set('limit', '100');
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: whatsapp.bearerHeader(),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  if (!res.ok) {
    const diagnostico = diagnosticoMeta(res, data);
    throw new Error(
      `No se pudo consultar Meta: HTTP ${res.status}, código ${diagnostico.codigo ?? 'desconocido'}, ` +
        `referencia ${diagnostico.referenciaMeta ?? 'no informada'}.`,
    );
  }
  if (!Array.isArray(data.data)) throw new Error('Meta no devolvió una lista de plantillas.');
  const plantillas = data.data
    .filter((plantilla) => plantilla.name === NOMBRE)
    .map((plantilla) => ({
      id: plantilla.id,
      nombre: plantilla.name,
      idioma: plantilla.language,
      estado: plantilla.status,
      categoria: plantilla.category,
      motivo_rechazo: plantilla.rejected_reason ?? null,
    }));
  return {
    consultado_en: new Date().toISOString(),
    nombre_solicitado: NOMBRE,
    idioma_solicitado: IDIOMA,
    disponible_para_envio: plantillas.some(
      (plantilla) => plantilla.idioma === IDIOMA && plantilla.estado === 'APPROVED',
    ),
    plantillas,
    ultima_modificacion_meta:
      'No informada por esta consulta; revisar historial en WhatsApp Manager.',
    consulta_completa: !data.paging?.next,
  };
}

if (require.main === module) {
  diagnosticarPlantillaResultados()
    .then((resultado) => console.log(JSON.stringify(resultado, null, 2)))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}

module.exports = { diagnosticarPlantillaResultados };
