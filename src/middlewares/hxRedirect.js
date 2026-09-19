function hxRedirect(req, res, url) {
  if (req.get('HX-Request') === 'true') {
    res.set('HX-Redirect', url);
    return res.sendStatus(200);
  }
  return res.redirect(url);
}

module.exports = hxRedirect;
