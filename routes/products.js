const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/productController');
const optionalAuth = require('../middleware/optionalAuth');

router.get('/', ctrl.listProducts);
router.get('/:id', ctrl.getProduct);
router.get('/:id/claim-cta', optionalAuth, ctrl.getClaimCta);

module.exports = router;
