// Regenera GOOGLE_REFRESH_TOKEN cuando Google lo revoca/expira. La app de
// Google Cloud de este proyecto usa una cuenta de Gmail personal (no
// Workspace) en estado de publicación "Prueba" — decisión explícita del
// usuario, ver memoria del proyecto: pasar por la verificación completa de
// Google (política de privacidad publicada, revisión de días/semanas) es
// demasiado trámite para una herramienta de un solo consultorio. El costo
// de quedarse en "Prueba": el refresh_token expira solo cada 7 días
// (invalid_grant/"Token has been expired or revoked" en los logs), sin
// importar que se esté usando activamente — este script es el reemplazo
// rápido para cuando eso pase, en vez de rearmar el flujo OAuth a mano.
//
// Uso: pnpm run google:renovar-token
//   1. El server real (dev:localhost) debe estar DETENIDO mientras corre
//      este script — ambos usan el puerto 3000, y ese puerto+ruta ya está
//      registrado tal cual en Google Cloud Console como redirect URI
//      autorizado (no se puede cambiar sin ir a editarlo allá también).
//   2. Abre la URL que imprime, autoriza con la cuenta de Gmail correcta.
//   3. Pega el GOOGLE_REFRESH_TOKEN que imprime en .env.localhost.
//   4. Reinicia dev:localhost.
const http = require('http');
const { google } = require('googleapis');

const PORT = 3000;
const CALLBACK_PATH = '/auth/google/callback';
// Solo lectura/escritura de EVENTOS — es lo único que agenda.googleSync.js
// realmente usa (events.insert/update/delete/list), nunca calendarList ni
// otro alcance más amplio.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error(
    'Faltan GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET en el entorno.\n' +
      'Corre este script con "pnpm run google:renovar-token" (carga .env.localhost solo).',
  );
  process.exit(1);
}

const redirectUri = `http://localhost:${PORT}${CALLBACK_PATH}`;
const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  // Sin esto, Google NO vuelve a mandar refresh_token si ya autorizaste
  // antes esta combinación cuenta+cliente+scope (solo lo manda la PRIMERA
  // vez) — el objetivo de este script es justo reemplazar uno que ya
  // expiró, así que siempre hay que forzarlo.
  prompt: 'consent',
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== CALLBACK_PATH) {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Autorización cancelada</h1><p>Puedes cerrar esta pestaña.</p>');
    console.error(`\nGoogle regresó un error: ${error}`);
    server.close(() => process.exit(1));
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Falta el parámetro "code".');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Listo</h1><p>Ya puedes cerrar esta pestaña y regresar a la terminal.</p>');

    if (!tokens.refresh_token) {
      console.error(
        '\nGoogle NO regresó un refresh_token nuevo (raro con prompt=consent).\n' +
          'Ve a https://myaccount.google.com/permissions, quita el acceso de\n' +
          '"omega-hosp-vet-calsync" y vuelve a correr el script.',
      );
      server.close(() => process.exit(1));
      return;
    }

    console.log('\n✔ Nuevo GOOGLE_REFRESH_TOKEN generado. Pégalo en .env.localhost:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('Después reinicia "pnpm run dev:localhost" para que lo tome.');
    server.close(() => process.exit(0));
  } catch (err) {
    console.error('\nNo se pudo intercambiar el código por tokens:', err.message);
    res.writeHead(500).end('Error al obtener el token, revisa la terminal.');
    server.close(() => process.exit(1));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nEl puerto ${PORT} ya está en uso — probablemente "pnpm run dev:localhost"\n` +
        'sigue corriendo. Detenlo primero (Ctrl+C en su terminal) y vuelve a\n' +
        'correr este script; el callback de Google necesita ese mismo puerto\n' +
        `(está registrado tal cual como redirect URI en Google Cloud Console).`,
    );
  } else {
    console.error('\nError al levantar el servidor temporal:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('Abre esta URL en tu navegador (con la cuenta de Gmail correcta) y autoriza:\n');
  console.log(authUrl);
  console.log('\nEsperando la autorización...');
});
