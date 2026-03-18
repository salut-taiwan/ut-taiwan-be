const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const ctrl = require('../controllers/orderController');

router.use(auth);

router.get('/admin/all', adminOnly, ctrl.listAllOrders);
router.patch('/admin/:orderId/status', adminOnly, ctrl.updateOrderStatus);
router.post('/checkout', ctrl.checkout);
router.get('/', ctrl.listOrders);
router.get('/:id', ctrl.getOrder);
router.post('/:id/cancel', ctrl.cancelOrder);

module.exports = router;
