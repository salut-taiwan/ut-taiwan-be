const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/configController');

router.get('/fees', ctrl.getFees);

module.exports = router;
