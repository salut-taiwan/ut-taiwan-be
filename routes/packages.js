const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/packageController');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

router.get('/', ctrl.listPackages);
router.post('/sync', auth, adminOnly, ctrl.syncPackages);
router.get('/:id', ctrl.getPackage);

module.exports = router;
