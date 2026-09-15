const env = require('./config/env');
const logger = require('./config/logger');
const whatsappAgenda = require('./config/whatsappAgenda');
const db = require('./config/database');
const { store: sessionStore } = require('./config/session');
const app = require('./app');
const googleCalendarSyncJob = require('./jobs/googleCalendarSyncJob');
const plantillasWhatsappMetaSyncJob = require('./jobs/plantillasWhatsappMetaSyncJob');
// whatsappMensajesPendientesJob (US WA 001) y
// whatsapp.service.js#procesarMensajePendiente se retiraron por completo
// en US WA 009: esa lógica de clasificación por MENSAJE individual (nunca
// conectada a nada desde US WA 003, que introdujo la agrupación) quedó
// reemplazada por whatsapp.service.js#clasificarYResponderGrupo, que
// clasifica el GRUPO consolidado — la recuperación de huérfanos ya la
// cubre whatsappAgrupacionJob.js (reclamarConversacionVencida, US WA 003
// AC13), no hace falta un poller aparte.
const whatsappAgrupacionJob = require('./jobs/whatsappAgrupacionJob');
const whatsappSeguimientoJob = require('./jobs/whatsappSeguimientoJob');
const whatsappAtencionHumanaJob = require('./jobs/whatsappAtencionHumanaJob');
const whatsappAlertasJob = require('./jobs/whatsappAlertasJob');

whatsappAgenda.validarConfiguracionAlArrancar(logger);

const server = app.listen(env.port, () => {
  logger.info(`Omega Vet AdminSite escuchando en el puerto ${env.port} (${env.nodeEnv})`);
});

const googleSyncInterval = googleCalendarSyncJob.start();
const plantillasMetaSyncInterval = plantillasWhatsappMetaSyncJob.start();
const whatsappAgrupacionInterval = whatsappAgrupacionJob.start();
const whatsappSeguimientoInterval = whatsappSeguimientoJob.start();
const whatsappAtencionHumanaInterval = whatsappAtencionHumanaJob.start();
const whatsappAlertasInterval = whatsappAlertasJob.start();

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
  if (whatsappAtencionHumanaInterval) clearInterval(whatsappAtencionHumanaInterval);
  if (whatsappAlertasInterval) clearInterval(whatsappAlertasInterval);
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
