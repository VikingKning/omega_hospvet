// La configuración real vive en src/db/knexfile.js (junto a migrations/ y seeds/).
// Este archivo solo existe para que `knex migrate:latest` funcione desde la raíz
// del repo sin necesitar `--knexfile src/db/knexfile.js` en cada comando.
module.exports = require('./src/db/knexfile');
