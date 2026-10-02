const express = require('express');
const env = require('../../config/env');
const controller = require('./legal.controller');

const router = express.Router();
const routerHostnameLegal = express.Router();

function esHostnameLegal(req) {
  return req.hostname?.toLowerCase() === env.legalHostname;
}

function prepararRutaLimpia(req, res, next) {
  req.legalBasePath = '';
  next();
}

routerHostnameLegal.use(prepararRutaLimpia);
routerHostnameLegal.get('/', controller.mostrarInicio);
routerHostnameLegal.get('/aviso-privacidad', controller.mostrarAvisoPrivacidad);
routerHostnameLegal.get('/aviso-privacidad.pdf', controller.descargarAvisoPrivacidad);
routerHostnameLegal.get('/terminos', controller.mostrarTerminos);
routerHostnameLegal.get('/eliminacion-de-datos', controller.mostrarEliminacionDatos);
routerHostnameLegal.use((req, res) => res.status(404).send('Página no encontrada.'));

router.use((req, res, next) => {
  if (!esHostnameLegal(req)) return next();

  // Los únicos archivos estáticos requeridos por el portal legal continúan
  // resolviéndose mediante express.static. Cualquier otra ruta del hostname
  // legal queda dentro del router restringido y nunca alcanza el portal.
  if (req.path === '/css/legal.css' || req.path === '/assets/imgs/icon.png') return next();
  return routerHostnameLegal(req, res, next);
});

router.get('/legal', controller.mostrarInicio);
router.get('/legal/aviso-privacidad', controller.mostrarAvisoPrivacidad);
router.get('/legal/aviso-privacidad.pdf', controller.descargarAvisoPrivacidad);
router.get('/legal/terminos', controller.mostrarTerminos);
router.get('/legal/eliminacion-de-datos', controller.mostrarEliminacionDatos);

module.exports = router;
