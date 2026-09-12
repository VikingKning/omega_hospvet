// Diseño del correo de "Resultados de laboratorio disponibles" — pedido
// explícito del usuario (mockup HTML propio, ver conversación). Tablas
// anidadas + estilos inline a propósito: es un correo real, no una página
// web — los clientes de correo (Outlook, Gmail, etc.) no soportan CSS
// moderno ni <style> externo de forma confiable, por eso cada estilo va en
// el atributo `style=""` de cada elemento.
//
// El logo se manda como adjunto con Content-ID (`cid:logo-omega`, ver
// laboratorio.envios.js) en vez de una URL pública con `src="https://..."`:
// este sistema no tiene un dominio público que sirva `public/` fuera de la
// red de la clínica, así que una URL normal se vería rota en el correo.
//
// Pedido explícito del usuario: sin nombres de estudios ni links de
// "Preferencias de correo"/"Cancelar suscripción" (son de un newsletter de
// marketing, no aplican a un aviso transaccional de un cliente ya
// registrado) — la ficha muestra solo Paciente/Fecha de requerimiento/N.°
// de orden, los 3 en un mismo renglón.
function idLabel(id) {
  return `LAB-${String(id).padStart(3, '0')}`;
}

// Mismo criterio que formatFecha() en laboratorio-panel.ejs: fecha_solicitud
// es una columna DATE pura (sin hora) — leerla con getters LOCALES (en vez
// de getUTC*) correría el riesgo de mostrar un día distinto según la zona
// horaria del proceso de Node.
function formatFecha(fecha) {
  if (!fecha) return '—';
  const d = new Date(fecha);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// La insignia del adjunto refleja el archivo real, no presupone PDF. Se
// toma la última extensión ("estudio.final.jpg" -> JPG), se normaliza a
// mayúsculas y se limita a 4 caracteres para conservar el cuadro de 38 px.
// Un nombre sin extensión usa FILE como fallback explícito.
function extensionLabel(nombreArchivo) {
  const nombre = String(nombreArchivo ?? '');
  const punto = nombre.lastIndexOf('.');
  if (punto <= 0 || punto === nombre.length - 1) return 'FILE';

  const extension = nombre
    .slice(punto + 1)
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  return extension ? extension.slice(0, 4) : 'FILE';
}

// Un registro puede tener varios archivos adjuntos reales (uno consolidado
// para todos los estudios, o uno por estudio) — se repite este bloque una
// vez por archivo, nunca se asume que solo hay uno.
function bloqueAdjunto(nombreArchivo) {
  const extension = extensionLabel(nombreArchivo);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px dashed #b9cae6;border-radius:10px;background-color:#ffffff;margin-bottom:10px;">
      <tr>
        <td width="52" style="width:52px;padding:16px 0 16px 18px;" valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="38" style="width:38px;">
            <tr><td align="center" valign="middle" height="38" bgcolor="#1b4ca6" style="width:38px;height:38px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;mso-line-height-rule:exactly;">${extension}</td></tr>
          </table>
        </td>
        <td valign="middle" style="padding:16px 18px 16px 14px;font-family:Arial,Helvetica,sans-serif;">
          <p style="margin:0;font-size:14px;line-height:20px;font-weight:bold;color:#24406f;">${nombreArchivo}</p>
          <p style="margin:2px 0 0 0;font-size:13px;line-height:18px;color:#5b6678;">Documento adjunto a este correo</p>
        </td>
      </tr>
    </table>`;
}

function construirCorreoResultados({
  nombreTutor,
  nombreMascota,
  fechaSolicitud,
  folioId,
  archivos,
  calendarioCitas,
  googleMapsUrl,
}) {
  const fecha = formatFecha(fechaSolicitud);
  const folio = idLabel(folioId);
  const bloquesAdjuntos = archivos.map((a) => bloqueAdjunto(a.nombreOriginal)).join('\n');

  const subject = `Resultados de laboratorio de ${nombreMascota}`;

  const text =
    `Hola ${nombreTutor},\n\n` +
    `Los resultados de laboratorio de ${nombreMascota} ya están listos ` +
    `(orden ${folio}, fecha de requerimiento ${fecha}). Los encontrarás ` +
    `adjuntos a este correo.\n\n` +
    `Omega Hospital Veterinario`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Resultados de laboratorio disponibles</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  @media only screen and (max-width:620px){
    .container{width:100% !important;}
    .px{padding-left:24px !important;padding-right:24px !important;}
    .h1{font-size:24px !important;line-height:30px !important;}
    .stack{display:block !important;width:100% !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#eef3fb;">
<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#eef3fb;">Los resultados de laboratorio de tu mascota ya están listos. Los encontrará adjuntos en este correo.</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eef3fb;">
<tr><td align="center" style="padding:32px 12px;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:14px;border:1px solid #d6e0f0;">

  <!-- Barra superior -->
  <tr><td style="background-color:#24406f;height:6px;line-height:6px;font-size:6px;border-radius:14px 14px 0 0;">&nbsp;</td></tr>

  <!-- Logo -->
  <tr><td align="center" class="px" style="padding:32px 40px 8px 40px;">
    <img src="cid:logo-omega" width="190" alt="Omega Hospital Veterinario" style="display:block;width:190px;max-width:190px;height:auto;border:0;">
  </td></tr>

  <tr><td align="center" class="px" style="padding:4px 40px 24px 40px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:#5b6678;">
    Omega Hospital Veterinario
  </td></tr>

  <tr><td class="px" style="padding:0 40px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="height:1px;line-height:1px;font-size:1px;background-color:#e4ebf6;">&nbsp;</td></tr></table></td></tr>

  <!-- Encabezado -->
  <tr><td class="px" style="padding:32px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;">
    <p class="h1" style="margin:0;font-size:26px;line-height:34px;font-weight:bold;color:#24406f;mso-line-height-rule:exactly;">Resultados de laboratorio disponibles</p>
  </td></tr>

  <tr><td class="px" style="padding:16px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3b4354;mso-line-height-rule:exactly;">
    <p style="margin:0 0 14px 0;">Estimado(a) <strong style="color:#24406f;">${nombreTutor}</strong>,</p>
    <p style="margin:0 0 14px 0;">Te informamos que los resultados de los análisis de laboratorio de tu mascota <strong style="color:#24406f;">${nombreMascota}</strong> ya se encuentran listos. Los adjuntamos en este correo.</p>
    <p style="margin:0;">Te recomendamos ampliamente revisarlos junto con tu médico veterinario tratante, quien podrá interpretarlos correctamente con el contexto clínico de tu mascota.</p>
  </td></tr>
  <tr><td class="px" style="padding:16px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#3b4354;mso-line-height-rule:exactly;">
    <p style="margin:0;">Para esto, puedes visitarnos en nuestra sucursal (<a href="${googleMapsUrl}" style="color:#0066cc;text-decoration:underline;">aquí</a>) para la revisión de los resultados o, si lo prefieres, agenda una cita para apartar tu lugar dando clic en el boton de abajo, será un gusto atenderte.</p>
  </td></tr>
  
  <!-- Botón -->
  <tr><td align="center" class="px" style="padding:16px 40px 0 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" bgcolor="#24406f" style="border-radius:8px;">
        <a href="${calendarioCitas}" style="display:block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">Agendar consulta de seguimiento</a>
      </td></tr>
    </table>
  </td></tr>

  <!-- Ficha: Paciente / Fecha de requerimiento / N. de orden, un solo renglón -->
  <tr><td class="px" style="padding:28px 40px 0 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#f4f7fd;border:1px solid #dde6f4;border-radius:10px;">
      <tr>
        <td width="34%" class="stack" style="width:34%;padding:18px 10px 18px 22px;font-family:Arial,Helvetica,sans-serif;">
          <p style="margin:0 0 4px 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6b7688;">Paciente</p>
          <p style="margin:0;font-size:15px;line-height:20px;font-weight:bold;color:#24406f;">${nombreMascota}</p>
        </td>
        <td width="33%" class="stack" style="width:33%;padding:18px 10px;font-family:Arial,Helvetica,sans-serif;">
          <p style="margin:0 0 4px 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6b7688;">Fecha de requerimiento</p>
          <p style="margin:0;font-size:15px;line-height:20px;font-weight:bold;color:#24406f;">${fecha}</p>
        </td>
        <td width="33%" class="stack" style="width:33%;padding:18px 22px 18px 10px;font-family:Arial,Helvetica,sans-serif;">
          <p style="margin:0 0 4px 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6b7688;">N.° de orden</p>
          <p style="margin:0;font-size:15px;line-height:20px;font-weight:bold;color:#24406f;">${folio}</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Adjunto(s) -->
  <tr><td class="px" style="padding:20px 40px 0 40px;">
    ${bloquesAdjuntos}
  </td></tr>

  <tr><td align="center" class="px" style="padding:14px 40px 32px 40px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#5b6678;">
    ¿Dudas sobre los resultados? Responda este correo o llámenos al <a href="tel:+527711634578" style="color:#1b4ca6;text-decoration:underline;">771-163-4578</a>.
  </td></tr>

  <!-- Aviso -->
  <tr><td class="px" style="padding:0 40px 32px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#f4f7fd;border-radius:8px;">
      <tr><td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#5b6678;">
        Este documento contiene información clínica confidencial dirigida únicamente al titular del paciente. Si recibió este correo por error, por favor elimínelo y notifíquenos.
      </td></tr>
    </table>
  </td></tr>

  <!-- Pie -->
  <tr><td style="background-color:#24406f;border-radius:0 0 14px 14px;padding:26px 40px;font-family:Arial,Helvetica,sans-serif;" class="px">
    <p style="margin:0 0 6px 0;font-size:14px;line-height:20px;font-weight:bold;color:#ffffff;">Omega Hospital Veterinario</p>
    <p style="margin:0 0 12px 0;font-size:13px;line-height:20px;color:#c3d2ea;">Ébano 309, Los Cedros, 42033 Pachuca de Soto, Hidalgo, México.<br><a href="tel:+527711634578" style="color:#ffffff;text-decoration:underline;">771-163-4578</a> · <a href="mailto:contacto@omegaveterinaria.com" style="color:#ffffff;text-decoration:underline;">contacto@omegaveterinaria.com</a> · <a href="${googleMapsUrl}" style="color:#ffffff;text-decoration:underline;">Google Maps</a></p>
    <p style="margin:0;font-size:12px;line-height:18px;color:#9fb4d6;">© ${new Date().getFullYear()} Omega Hospital Veterinario. Todos los derechos reservados.</p>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { construirCorreoResultados };
