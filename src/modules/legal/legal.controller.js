const configuracionService = require('../configuracion/configuracion.service');
const logger = require('../../config/logger');
const { extraerDocumentoPdf } = require('../configuracion/aviso-privacidad-texto');

const CORREO_PRIVACIDAD = 'vet.omega.interno17@gmail.com';
let cacheAvisoPublico = { archivo: null, bloques: null };

function datosComunes(req) {
  return {
    rutaActual: req.path,
    legalBasePath: req.legalBasePath ?? '/legal',
    correoPrivacidad: CORREO_PRIVACIDAD,
  };
}

function mostrarInicio(req, res) {
  res.set('Cache-Control', 'public, max-age=300');
  res.render('legal/inicio', datosComunes(req));
}

function mostrarTerminos(req, res) {
  res.set('Cache-Control', 'public, max-age=300');
  res.render('legal/terminos', datosComunes(req));
}

function mostrarEliminacionDatos(req, res) {
  res.set('Cache-Control', 'public, max-age=300');
  res.render('legal/eliminacion-datos', datosComunes(req));
}

async function obtenerAvisoPublico() {
  const aviso = await configuracionService.obtenerAvisoPrivacidad();
  if (!aviso.archivo) {
    cacheAvisoPublico = { archivo: null, bloques: null };
    return { aviso, bloques: [], disponible: false, errorLectura: false };
  }

  if (cacheAvisoPublico.archivo === aviso.archivo && cacheAvisoPublico.bloques?.length) {
    return {
      aviso,
      bloques: cacheAvisoPublico.bloques,
      disponible: true,
      errorLectura: false,
    };
  }

  try {
    const buffer = await configuracionService.leerArchivoAviso(aviso.archivo);
    const { texto, bloques } = await extraerDocumentoPdf(buffer);
    if (texto) cacheAvisoPublico = { archivo: aviso.archivo, bloques };
    return {
      aviso,
      bloques,
      disponible: Boolean(texto),
      errorLectura: !texto,
    };
  } catch (error) {
    logger.warn(
      { err: error, archivo: aviso.archivo },
      'No fue posible extraer el texto del aviso de privacidad vigente.',
    );
    return { aviso, bloques: [], disponible: false, errorLectura: true };
  }
}

async function mostrarAvisoPrivacidad(req, res, next) {
  try {
    const avisoPublico = await obtenerAvisoPublico();
    res.set('Cache-Control', 'no-cache');
    res.render('legal/aviso-privacidad', {
      ...datosComunes(req),
      ...avisoPublico,
    });
  } catch (error) {
    next(error);
  }
}

async function descargarAvisoPrivacidad(req, res, next) {
  try {
    const aviso = await configuracionService.obtenerAvisoPrivacidad();
    if (!aviso.archivo) {
      return res.status(404).json({ error: 'Todavía no hay un aviso de privacidad vigente.' });
    }

    const buffer = await configuracionService.leerArchivoAviso(aviso.archivo);
    const nombreDescarga =
      aviso.nombreOriginal?.replace(/\.(docx?|pdf)$/i, '.pdf') ||
      'aviso-de-privacidad-omegavet.pdf';
    res.set({
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="aviso-de-privacidad-omegavet.pdf"; filename*=UTF-8''${encodeURIComponent(nombreDescarga)}`,
    });
    return res.send(buffer);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'El archivo del aviso vigente no está disponible.' });
    }
    return next(error);
  }
}

module.exports = {
  mostrarInicio,
  mostrarAvisoPrivacidad,
  descargarAvisoPrivacidad,
  mostrarTerminos,
  mostrarEliminacionDatos,
};
