const logger = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const repository = require('./plantillas_whatsapp.repository');
const { nombreMeta, CATEGORIA_TEXTO_LIBRE } = require('./plantillas_whatsapp.service');

async function sincronizarDatosMeta(plantillasMeta, plantillasLocales) {
  const locales = plantillasLocales ?? (await repository.findParaSincronizarMeta());
  const metaPorNombre = new Map(
    (plantillasMeta ?? []).map((plantilla) => [plantilla.name, plantilla]),
  );
  let actualizadas = 0;

  for (const plantilla of locales) {
    if (plantilla.categoria_meta === CATEGORIA_TEXTO_LIBRE) continue;
    const datosMeta = metaPorNombre.get(nombreMeta(plantilla.slug));
    if (!datosMeta) continue;
    const categoriaMeta = datosMeta.category
      ? String(datosMeta.category).toUpperCase()
      : plantilla.categoria_meta;
    const aprobadoMeta = datosMeta.status === 'APPROVED';
    if (
      categoriaMeta !== plantilla.categoria_meta ||
      aprobadoMeta !== Boolean(plantilla.aprobado_meta)
    ) {
      await repository.actualizarDatosMeta(plantilla.id, { categoriaMeta, aprobadoMeta });
      actualizadas += 1;
    }
  }

  return actualizadas;
}

async function revisarAprobaciones() {
  if (!whatsapp.isWhatsappConfigured()) {
    logger.debug('WhatsApp no configurado, se omite la revisión de aprobaciones de Meta.');
    return;
  }

  const locales = await repository.findParaSincronizarMeta();
  if (locales.length === 0) return;

  try {
    const url = `${whatsapp.templatesUrl()}?fields=name,status,category&limit=100`;
    const res = await fetch(url, { headers: whatsapp.authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      logger.error(
        { status: res.status, data },
        'No se pudo consultar el estado de las plantillas en Meta.',
      );
      return;
    }

    await sincronizarDatosMeta(data.data, locales);
  } catch (err) {
    logger.error({ err }, 'Falló un ciclo de revisión de aprobaciones de plantillas en Meta.');
  }
}

module.exports = { revisarAprobaciones, sincronizarDatosMeta };
