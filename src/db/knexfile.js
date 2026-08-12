const path = require('path');
const env = require('../config/env');

module.exports = {
  client: 'pg',
  connection: env.db,
  pool: { min: 0, max: 10 },
  asyncStackTraces: env.nodeEnv !== 'production',
  migrations: {
    directory: path.join(__dirname, 'migrations'),
  },
  seeds: {
    directory: path.join(__dirname, 'seeds'),
  },
};
