const service = require('./doctores.service');

async function list(req, res, next) {
  try {
    const data = await service.list(req.query);
    res.render('doctores', { ...data, user: req.session.user });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
