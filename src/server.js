const env = require('./config/env');
const logger = require('./config/logger');
const whatsappAgenda = require('./config/whatsappAgenda');
const db = require('./config/database');
const { store: sessionStore } = require('./config/session');
const app = require('./app');
const googleCalendarSyncJob = require('./jobs/googleCalendarSyncJob');
const plantillasWhatsappMetaSyncJob = require('./jobs/plantillasWhatsappMetaSyncJob');
const whatsappAgrupacionJob = require('./jobs/whatsappAgrupacionJob');
const whatsappSeguimientoJob = require('./jobs/whatsappSeguimientoJob');
const whatsappAtencionHumanaJob = require('./jobs/whatsappAtencionHumanaJob');
const whatsappAlertasJob = require('./jobs/whatsappAlertasJob');
const whatsappFlujoAnteriorJob = require('./jobs/whatsappFlujoAnteriorJob');

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
const whatsappFlujoAnteriorInterval = whatsappFlujoAnteriorJob.start();

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
  if (whatsappFlujoAnteriorInterval) clearInterval(whatsappFlujoAnteriorInterval);
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
