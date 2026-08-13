const express = require('express');
const requireAuth = require('../../middlewares/requireAuth');
const requirePermission = require('../../middlewares/requirePermission');
const controller = require('./doctores.controller');

const router = express.Router();

router.get('/doctores.html', requireAuth, requirePermission('doctores.ver'), controller.list);

module.exports = router;
