const router = require('express').Router();
const ctrl = require('../controllers/paymentController');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const upload = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');

router.post('/:orderId/confirm',  auth, adminOnly, asyncHandler(ctrl.confirmPayment));
router.post('/:orderId/proof',    auth,             upload.single('file'), asyncHandler(ctrl.uploadProof));
router.post('/:orderId/invoice',  auth, adminOnly,  upload.single('file'), asyncHandler(ctrl.uploadInvoice));
router.get('/:orderId/proof',     auth,            asyncHandler(ctrl.viewProof));
router.get('/:orderId/invoice',   auth, adminOnly, asyncHandler(ctrl.viewInvoice));
router.get('/:orderId',           auth, asyncHandler(ctrl.getPaymentStatus));

module.exports = router;