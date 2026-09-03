// Job periódico (src/jobs/plantillasWhatsappMetaSyncJob.js): revisa el
// estado real en Meta de las plantillas que todavía no se han visto como
// aprobadas (aprobado_meta=false) y prende el flag en cuanto Meta las
// marca APPROVED. Solo LEE de Meta — el registro en sí (el POST) pasa en
// plantillas_whatsapp.service.js#registrarEnMeta, al crear/reactivar (push
// inmediato, mismo criterio que agenda.googleSync.js: push al momento +
// pull periódico).
const logger = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const repository = require('./plantillas_whatsapp.repository');
const { nombreMeta } = require('./plantillas_whatsapp.service');

async function revisarAprobaciones() {
  if (!whatsapp.isWhatsappConfigured()) {
    logger.debug('WhatsApp no configurado, se omite la revisión de aprobaciones de Meta.');
    return;
  }

  const pendientes = await repository.findPendientesAprobacionMeta();
  if (pendientes.length === 0) return;

  try {
    const url = `${whatsapp.templatesUrl()}?fields=name,status&limit=100`;
    const res = await fetch(url, { headers: whatsapp.authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      logger.error(
        { status: res.status, data },
        'No se pudo consultar el estado de las plantillas en Meta.',
      );
      return;
    }

    const estadoPorNombre = new Map((data.data ?? []).map((t) => [t.name, t.status]));

    for (const plantilla of pendientes) {
      if (estadoPorNombre.get(nombreMeta(plantilla.slug)) === 'APPROVED') {
        await repository.marcarAprobadoMeta(plantilla.id);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Falló un ciclo de revisión de aprobaciones de plantillas en Meta.');
  }
}

module.exports = { revisarAprobaciones };
