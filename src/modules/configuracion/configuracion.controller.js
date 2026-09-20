const service = require('./configuracion.service');
const { generateCsrfToken } = require('../../config/csrf');

async function mostrarForm(req, res, next) {
  try {
    const [aviso, versiones] = await Promise.all([
      service.obtenerAvisoPrivacidad(),
      service.listarUltimasVersionesAviso(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('configuracion-generales', {
      aviso,
      versiones,
      mensaje: null,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function guardarAviso(req, res, next) {
  const csrfToken = generateCsrfToken(req, res);
  try {
    if (!req.file) {
      throw new service.ConfiguracionValidationError('Selecciona un archivo PDF para continuar.');
    }
    const aviso = await service.guardarAvisoPrivacidad({
      buffer: req.file.buffer,
      // Busboy (usado por multer) decodifica el nombre del archivo como
      // latin1 aunque el navegador lo mande en UTF-8 — sin esto, cualquier
      // acento o guion especial en el nombre queda mojibake ("â" en vez de
      // "–"). Ver: https://github.com/expressjs/multer/issues/1104
      nombreOriginal: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
      mimeType: req.file.mimetype,
      version: req.body.version,
      usuarioId: req.session.user.id,
    });
    const versiones = await service.listarUltimasVersionesAviso();
    return res.render('partials/configuracion-generales-form', {
      aviso,
      versiones,
      mensaje: 'Aviso de privacidad actualizado correctamente.',
      error: null,
      csrfToken,
    });
  } catch (err) {
    if (err.status) {
      const [aviso, versiones] = await Promise.all([
        service.obtenerAvisoPrivacidad(),
        service.listarUltimasVersionesAviso(),
      ]);
      return res.render('partials/configuracion-generales-form', {
        aviso,
        versiones,
        mensaje: null,
        error: err.message,
        csrfToken,
      });
    }
    return next(err);
  }
}

module.exports = { mostrarForm, guardarAviso };
