const env = require('./config/env');
const logger = require('./config/logger');
const db = require('./config/database');
const { store: sessionStore } = require('./config/session');
const app = require('./app');

const server = app.listen(env.port, () => {
  logger.info(`Omega Vet AdminSite escuchando en el puerto ${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal) {
  logger.info(`Señal ${signal} recibida, cerrando servidor...`);
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
