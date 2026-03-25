const router = require('express').Router();
const ctrl = require('../controllers/paymentController');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const upload = require('../middleware/upload');

router.post('/:orderId/confirm',  auth, adminOnly, ctrl.confirmPayment);
router.post('/:orderId/proof',    auth,             upload.single('file'), ctrl.uploadProof);
router.post('/:orderId/invoice',  auth, adminOnly,  upload.single('file'), ctrl.uploadInvoice);
router.get('/:orderId',           auth, ctrl.getPaymentStatus);

module.exports = router;