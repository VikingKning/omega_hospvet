const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const isDevelopment = !isProduction && !isTest;

const logger = pino({
  enabled: !isTest,
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined,
});

module.exports = logger;
