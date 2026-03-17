const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/moduleController');

router.get('/', ctrl.listModules);
router.get('/search', ctrl.searchModules);
router.get('/:id', ctrl.getModule);

module.exports = router;
