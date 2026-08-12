const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/sksPaymentController');
const { asyncHandler } = require('../utils/asyncHandler');

router.use(auth);

// Student endpoints
router.post('/quote', asyncHandler(ctrl.quoteSksPayment));
router.post('/upload-slip', upload.single('file'), asyncHandler(ctrl.uploadUtSlip));
router.post('/upload-proof', upload.single('file'), asyncHandler(ctrl.uploadTransferProof));
router.post('/', asyncHandler(ctrl.submitSksPayment));
router.get('/mine', asyncHandler(ctrl.listMineSksPayments));

// Admin endpoints
router.get('/admin/all', adminOnly, asyncHandler(ctrl.listAdminSksPayments));
router.get('/admin/:id/slip-url', adminOnly, asyncHandler(ctrl.getAdminSlipSignedUrl));
router.get('/admin/:id/proof-url', adminOnly, asyncHandler(ctrl.getAdminProofSignedUrl));
router.patch('/admin/:id/complete', adminOnly, asyncHandler(ctrl.completeSksPayment));
router.patch('/admin/:id/reject', adminOnly, asyncHandler(ctrl.rejectSksPayment));

module.exports = router;
