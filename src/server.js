const env = require('./config/env');
const logger = require('./config/logger');
const db = require('./config/database');
const { store: sessionStore } = require('./config/session');
const app = require('./app');
const googleCalendarSyncJob = require('./jobs/googleCalendarSyncJob');
const plantillasWhatsappMetaSyncJob = require('./jobs/plantillasWhatsappMetaSyncJob');
// whatsappMensajesPendientesJob (US WA 001) se retira de aquí: US WA 003
// desactivó el disparo inmediato de clasificación/respuesta que ese job
// recuperaba cada 30s — dejarlo activo reintroduciría el mismo problema,
// solo que con 30s de retraso en vez de al instante. El archivo y
// whatsapp.service.js#procesarMensajePendiente NO se borran: una historia
// futura probablemente reutilice esa lógica contra el grupo consolidado.
const whatsappAgrupacionJob = require('./jobs/whatsappAgrupacionJob');
const whatsappSeguimientoJob = require('./jobs/whatsappSeguimientoJob');

const server = app.listen(env.port, () => {
  logger.info(`Omega Vet AdminSite escuchando en el puerto ${env.port} (${env.nodeEnv})`);
});

const googleSyncInterval = googleCalendarSyncJob.start();
const plantillasMetaSyncInterval = plantillasWhatsappMetaSyncJob.start();
const whatsappAgrupacionInterval = whatsappAgrupacionJob.start();
const whatsappSeguimientoInterval = whatsappSeguimientoJob.start();

// Doble Ctrl+C (o SIGINT y SIGTERM llegando casi juntos, ej. de una
// terminal/supervisor que manda ambos al cerrar) disparaba shutdown() dos
// veces en paralelo — la segunda pasada llamaba sessionStore.close() sobre
// un pool ya cerrado por la primera, y pg-pool revienta con "Called end on
// pool more than once" en vez de ignorarlo. Este flag hace que solo la
// primera señal recibida tenga efecto.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Señal ${signal} recibida, cerrando servidor...`);
  if (googleSyncInterval) clearInterval(googleSyncInterval);
  if (plantillasMetaSyncInterval) clearInterval(plantillasMetaSyncInterval);
  if (whatsappAgrupacionInterval) clearInterval(whatsappAgrupacionInterval);
  if (whatsappSeguimientoInterval) clearInterval(whatsappSeguimientoInterval);
  server.close(async () => {
    await Promise.all([db.destroy(), sessionStore.close()]);
    logger.info('Servidor y conexiones a base de datos cerrados.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception, terminando el proceso');
  process.exit(1);
});
