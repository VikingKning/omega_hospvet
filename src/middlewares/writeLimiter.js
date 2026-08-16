const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Límite general a las rutas de escritura del panel (áreas/doctores/
// plantillas/usuarios) — no cubre /login, que ya tiene su propio mecanismo
// de bloqueo por intentos fallidos en la BD (US-106, ver auth.routes.js).
// Pensado para un panel interno de una sola clínica, no una API pública: la
// ventana/tope son generosos a propósito, solo buscan frenar un script
// automatizado, no el uso manual normal.
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;

const writeLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  // Se agrupa por usuario autenticado (todas estas rutas ya pasan por
  // requireAuth) en vez de por IP: varias terminales de la clínica pueden
  // compartir la misma IP pública (NAT), y agrupar por IP las penalizaría
  // entre sí. ipKeyGenerator() normaliza IPv6 para el fallback sin sesión —
  // express-rate-limit lo exige explícitamente para evitar colisiones de
  // clave en IPv6.
  keyGenerator: (req) =>
    req.session?.user?.id ? `user:${req.session.user.id}` : ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Demasiadas solicitudes, intenta de nuevo en un momento.' });
  },
});

module.exports = writeLimiter;
module.exports.MAX_REQUESTS = MAX_REQUESTS;
