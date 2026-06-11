const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/configController');

router.get('/fees', ctrl.getFees);
router.get('/banks', ctrl.getBanks);
router.get('/chat-widget', ctrl.getChatWidget);

module.exports = router;
