const { generateCsrfToken } = require('../../config/csrf');
const service = require('./whatsapp.alertas.service');
const eventos = require('./whatsapp.alertas.eventos');

async function listar(req, res, next) {
  try {
    const alertas = await service.listarPendientes(req.session.user.id);
    const csrfToken = generateCsrfToken(req, res);
    res.json({ alertas, csrfToken });
  } catch (err) {
    next(err);
  }
}

function eventosSse(req, res) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
  });
  res.flushHeaders();
  const cancelar = eventos.suscribir(res);
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write('event: actualizar\ndata: {}\n\n');
  }, 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    cancelar();
  });
}

async function registrarNavegador(req, res, next) {
  try {
    const resultado = await service.registrarResultadoNavegador(
      Number(req.params.id),
      req.session.user.id,
      req.body,
    );
    res.json(resultado);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function atender(req, res, next) {
  try {
    const alerta = await service.atender(Number(req.params.id), req.session.user.id);
    res.json({ atendida: true, alertaId: alerta.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = { listar, eventosSse, registrarNavegador, atender };
