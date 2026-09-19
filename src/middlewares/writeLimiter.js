const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;

const writeLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.session?.user?.id ? `user:${req.session.user.id}` : ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Demasiadas solicitudes, intenta de nuevo en un momento.' });
  },
});

module.exports = writeLimiter;
module.exports.MAX_REQUESTS = MAX_REQUESTS;
