'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/storageController');

// Match anything after /api/storage/ — public bucket reads only.
router.get('/*', ctrl.proxyStorage);

module.exports = router;
