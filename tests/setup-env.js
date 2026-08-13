// override:true es necesario porque este shell (y cualquier otro con un
// DB_PASSWORD/DB_* heredado de otro proyecto en su .bashrc/.zshrc) ya puede
// traer esas variables puestas antes de que Node arranque; sin override,
// dotenv nunca las reemplaza y los tests terminan usando credenciales de
// otro proyecto en vez de las de .env.test.
require('dotenv').config({ path: '.env.test', override: true });
