const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/packageController');

router.get('/', ctrl.listPackages);
router.get('/:id', ctrl.getPackage);

module.exports = router;
