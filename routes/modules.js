const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const ctrl = require('../controllers/moduleController');

router.get('/', ctrl.listModules);
router.get('/search', ctrl.searchModules);
router.post('/', auth, adminOnly, ctrl.createModule);
router.get('/:id', ctrl.getModule);

module.exports = router;
