// Reconstrucción del menú: requirePermission ahora acepta también un array
// de códigos con semántica OR (basta con tener AL MENOS uno) — caso real:
// /agenda.html combina las áreas Consultas y Cirugías en una sola página
// (ver app.js#modulePages), así que el acceso exige agenda.consultas.ver O
// agenda.cirugias.ver, no ambos.
jest.mock('../../src/middlewares/hxRedirect');
const hxRedirect = require('../../src/middlewares/hxRedirect');
const requirePermission = require('../../src/middlewares/requirePermission');

function makeReq(permissions) {
  return { session: { user: { permissions } } };
}

describe('requirePermission (string, comportamiento original)', () => {
  it('deja pasar si la sesión tiene el permiso exacto', () => {
    const next = jest.fn();
    requirePermission('areas.ver')(makeReq(['areas.ver']), {}, next);
    expect(next).toHaveBeenCalled();
    expect(hxRedirect).not.toHaveBeenCalled();
  });

  it('redirige a /main.html si la sesión no tiene el permiso', () => {
    const next = jest.fn();
    const res = {};
    const req = makeReq(['otro.permiso']);
    requirePermission('areas.ver')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(hxRedirect).toHaveBeenCalledWith(req, res, '/main.html');
  });

  it('sin sesión de usuario, redirige (permissions = [])', () => {
    const next = jest.fn();
    const res = {};
    const req = { session: {} };
    requirePermission('areas.ver')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(hxRedirect).toHaveBeenCalledWith(req, res, '/main.html');
  });
});

describe('requirePermission (array, semántica OR)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deja pasar si la sesión tiene AL MENOS uno de los códigos', () => {
    const next = jest.fn();
    requirePermission(['agenda.consultas.ver', 'agenda.cirugias.ver'])(
      makeReq(['agenda.cirugias.ver']),
      {},
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('deja pasar si tiene el otro código de la lista', () => {
    const next = jest.fn();
    requirePermission(['agenda.consultas.ver', 'agenda.cirugias.ver'])(
      makeReq(['agenda.consultas.ver']),
      {},
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('redirige si no tiene NINGUNO de los códigos de la lista', () => {
    const next = jest.fn();
    const res = {};
    const req = makeReq(['laboratorio.ver']);
    requirePermission(['agenda.consultas.ver', 'agenda.cirugias.ver'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(hxRedirect).toHaveBeenCalledWith(req, res, '/main.html');
  });
});

describe('requirePermission (función, evaluada por request)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deja pasar si el código construido a partir de req coincide con la sesión', () => {
    const next = jest.fn();
    const req = {
      params: { slug: 'cirugias' },
      session: { user: { permissions: ['agenda.cirugias.ver'] } },
    };
    requirePermission((r) => `agenda.${r.params.slug}.ver`)(req, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it('redirige si el código construido a partir de req no está en la sesión', () => {
    const next = jest.fn();
    const res = {};
    const req = {
      params: { slug: 'cirugias' },
      session: { user: { permissions: ['agenda.consultas.ver'] } },
    };
    requirePermission((r) => `agenda.${r.params.slug}.ver`)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(hxRedirect).toHaveBeenCalledWith(req, res, '/main.html');
  });

  it('la función también puede devolver un array (misma semántica OR)', () => {
    const next = jest.fn();
    const req = {
      params: { slug: 'consultas' },
      session: { user: { permissions: ['agenda.consultas.crear'] } },
    };
    requirePermission((r) => [`agenda.${r.params.slug}.ver`, `agenda.${r.params.slug}.crear`])(
      req,
      {},
      next,
    );
    expect(next).toHaveBeenCalled();
  });

  it('se re-evalúa en cada request (no queda "congelada" con el primer req)', () => {
    const middleware = requirePermission((r) => `agenda.${r.params.slug}.ver`);
    const next1 = jest.fn();
    middleware(
      {
        params: { slug: 'consultas' },
        session: { user: { permissions: ['agenda.consultas.ver'] } },
      },
      {},
      next1,
    );
    expect(next1).toHaveBeenCalled();

    const next2 = jest.fn();
    const res2 = {};
    middleware(
      {
        params: { slug: 'cirugias' },
        session: { user: { permissions: ['agenda.consultas.ver'] } },
      },
      res2,
      next2,
    );
    expect(next2).not.toHaveBeenCalled();
    expect(hxRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ params: { slug: 'cirugias' } }),
      res2,
      '/main.html',
    );
  });
});
