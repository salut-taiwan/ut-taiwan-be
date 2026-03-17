const router = require('express').Router();
const ctrl = require('../controllers/paymentController');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');

router.post('/:orderId/confirm', auth, adminOnly, ctrl.confirmPayment);
router.get('/:orderId', auth, ctrl.getPaymentStatus);

module.exports = router;