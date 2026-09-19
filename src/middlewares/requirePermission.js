const hxRedirect = require('./hxRedirect');

function requirePermission(code) {
  return (req, res, next) => {
    const resolved = typeof code === 'function' ? code(req) : code;
    const codes = Array.isArray(resolved) ? resolved : [resolved];
    const permissions = req.session.user?.permissions ?? [];

    if (!codes.some((c) => permissions.includes(c))) {
      return hxRedirect(req, res, '/main.html');
    }

    next();
  };
}

module.exports = requirePermission;
