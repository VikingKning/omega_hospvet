// Script de un solo uso para (re)generar el refresh_token de Google Calendar.
// Necesario porque los refresh tokens de una app OAuth en modo "Prueba"
// expiran cada 7 días — cuando eso pasa, hay que repetir este intercambio.
//
// Uso:
//   1. Detener el dev server (usa el mismo puerto 3000 que el redirect URI
//      registrado en Google Cloud Console).
//   2. Correr: npx dotenv -e .env.localhost -o --no-expand -- node scripts/intercambiar-token-google.js
//   3. Abrir la URL que imprime, iniciar sesión con la cuenta de Google de
//      la clínica y aceptar los permisos.
//   4. El script captura el redirect solo, imprime el nuevo GOOGLE_REFRESH_TOKEN.
//   5. Pegarlo en .env.localhost (reemplaza el valor viejo) y reiniciar el
//      dev server.
const http = require('http');
const { google } = require('googleapis');

const REDIRECT_URI = 'http://localhost:3000/auth/google/callback';

async function main() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('Faltan GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET en el entorno.');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // fuerza que Google reemita refresh_token aunque ya se haya autorizado antes
    scope: ['https://www.googleapis.com/auth/calendar'],
  });

  console.log('\nAbre esta URL en tu navegador e inicia sesión con la cuenta de la clínica:\n');
  console.log(authUrl);
  console.log('\nEsperando el consentimiento...\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/auth/google/callback') {
        res.writeHead(404).end();
        return;
      }
      const codigo = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        error
          ? '<h1>Falló el consentimiento, revisa la terminal.</h1>'
          : '<h1>Listo, ya puedes cerrar esta pestaña.</h1>',
      );
      server.close();
      if (error) reject(new Error(error));
      else resolve(codigo);
    });
    server.listen(3000);
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      '\nGoogle no regresó un refresh_token nuevo (raro con prompt:consent). Intenta de nuevo revocando el acceso previo en https://myaccount.google.com/permissions primero.',
    );
    process.exit(1);
  }

  console.log('\nGOOGLE_REFRESH_TOKEN nuevo — pégalo en .env.localhost:\n');
  console.log(tokens.refresh_token);
  console.log('');
}

main().catch((err) => {
  console.error('\nError durante el intercambio:', err.message);
  process.exit(1);
});
