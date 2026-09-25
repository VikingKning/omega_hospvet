const service = require('./configuracion.service');
const { generateCsrfToken } = require('../../config/csrf');

async function mostrarForm(req, res, next) {
  try {
    const [aviso, versiones, funciones] = await Promise.all([
      service.obtenerAvisoPrivacidad(),
      service.listarUltimasVersionesAviso(),
      service.obtenerFunciones(),
    ]);
    const csrfToken = generateCsrfToken(req, res);
    res.render('configuracion-generales', {
      aviso,
      versiones,
      funciones,
      mensaje: null,
      error: null,
      csrfToken,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
}

async function verificarArchivoExistente(req, res, next) {
  try {
    const { existe } = await service.existeArchivoAviso({
      nombreOriginal: req.query.nombreOriginal,
      hash: req.query.hash,
    });
    res.json({ existe });
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
      reenviar: req.body.reenviar === 'true',
      usuarioId: req.session.user.id,
    });
    const [versiones, funciones] = await Promise.all([
      service.listarUltimasVersionesAviso(),
      service.obtenerFunciones(),
    ]);
    return res.render('partials/configuracion-generales-form', {
      aviso,
      versiones,
      funciones,
      mensaje: 'Aviso de privacidad actualizado correctamente.',
      error: null,
      csrfToken,
    });
  } catch (err) {
    if (err.status) {
      const [aviso, versiones, funciones] = await Promise.all([
        service.obtenerAvisoPrivacidad(),
        service.listarUltimasVersionesAviso(),
        service.obtenerFunciones(),
      ]);
      return res.render('partials/configuracion-generales-form', {
        aviso,
        versiones,
        funciones,
        mensaje: null,
        error: err.message,
        csrfToken,
      });
    }
    return next(err);
  }
}

async function actualizarFuncion(req, res, next) {
  try {
    const funcion = await service.actualizarFuncion({
      clave: req.params.clave,
      habilitado: req.body.habilitado,
      usuarioId: req.session.user.id,
    });
    res.json(funcion);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

module.exports = { mostrarForm, verificarArchivoExistente, guardarAviso, actualizarFuncion };
