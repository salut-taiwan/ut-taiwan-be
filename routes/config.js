const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/configController');

router.get('/fees', ctrl.getFees);
router.get('/banks', ctrl.getBanks);

module.exports = router;
