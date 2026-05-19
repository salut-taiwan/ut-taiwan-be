const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/productController');

router.get('/', ctrl.listProducts);
router.get('/:id', ctrl.getProduct);

module.exports = router;
