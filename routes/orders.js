const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const requireVerified = require('../middleware/requireVerified');
const ctrl = require('../controllers/orderController');
const { asyncHandler } = require('../utils/asyncHandler');

router.use(auth);

router.get('/admin/all', adminOnly, asyncHandler(ctrl.listAllOrders));
router.patch('/admin/:orderId/status', adminOnly, asyncHandler(ctrl.updateOrderStatus));
router.post('/admin/:orderId/confirm-karunika', adminOnly, asyncHandler(ctrl.confirmKarunika));
router.patch('/admin/:orderId/items/:itemId/request-status', adminOnly, asyncHandler(ctrl.updateRequestItemStatus));
router.post('/checkout', requireVerified, asyncHandler(ctrl.checkout));
router.get('/', asyncHandler(ctrl.listOrders));
router.post('/:id/confirm-delivery', asyncHandler(ctrl.confirmDelivery));
router.get('/:id', asyncHandler(ctrl.getOrder));
router.post('/:id/cancel', asyncHandler(ctrl.cancelOrder));

module.exports = router;
