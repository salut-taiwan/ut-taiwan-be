const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/cartController');

router.use(auth);

router.get('/', ctrl.getCart);
router.post('/items', ctrl.addItem);
router.post('/packages', ctrl.addPackage);
router.put('/items/:itemId', ctrl.updateItem);
router.delete('/items/:itemId', ctrl.removeItem);
router.delete('/', ctrl.clearCart);

module.exports = router;
