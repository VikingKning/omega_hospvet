const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const isDevelopment = !isProduction && !isTest;

const logger = pino({
  enabled: !isTest,
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  // El transporte "pretty" corre en un worker thread; solo tiene sentido en
  // desarrollo interactivo. En test/producción se evita: en tests deja un
  // handle abierto que impide que Jest termine, y en producción no aporta.
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined,
});

module.exports = logger;
