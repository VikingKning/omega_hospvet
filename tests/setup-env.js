// override:true es necesario porque este shell (y cualquier otro con un
// DB_PASSWORD/DB_* heredado de otro proyecto en su .bashrc/.zshrc) ya puede
// traer esas variables puestas antes de que Node arranque; sin override,
// dotenv nunca las reemplaza y los tests terminan usando credenciales de
// otro proyecto en vez de las de .env.test.
require('dotenv').config({ path: '.env.test', override: true, quiet: true });

// passwordPolicy.js#checkPasswordPwned llama a la API real de Have I Been
// Pwned. Sin este stub, cualquier flujo de integración que establezca una
// contraseña (alta de usuario, US-110, cambio obligatorio tras reseteo)
// dispararía una petición HTTP real en cada corrida de la suite — lento,
// dependiente de red, y ajeno a lo que esos tests están verificando. Los
// tests que sí necesitan comportamiento específico de HIBP
// (tests/unit/passwordPolicy.test.js) sobreescriben global.fetch ellos
// mismos por caso, así que esto solo actúa como default seguro.
const originalFetch = global.fetch;
global.fetch = (url, ...args) => {
  if (typeof url === 'string' && url.includes('pwnedpasswords.com')) {
    return Promise.resolve({ ok: true, text: () => Promise.resolve('') });
  }
  return originalFetch(url, ...args);
};
