const knex = require('knex');
const env = require('./env');

const db = knex({
  client: 'pg',
  connection: env.db,
  pool: { min: 0, max: 10 },
});

module.exports = db;
