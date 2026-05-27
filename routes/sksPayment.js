const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/sksPaymentController');

router.use(auth);

// Student endpoints
router.post('/quote', ctrl.quoteSksPayment);
router.post('/upload-slip', upload.single('file'), ctrl.uploadUtSlip);
router.post('/upload-proof', upload.single('file'), ctrl.uploadTransferProof);
router.post('/', ctrl.submitSksPayment);
router.get('/mine', ctrl.listMineSksPayments);

// Admin endpoints
router.get('/admin/all', adminOnly, ctrl.listAdminSksPayments);
router.get('/admin/:id/slip-url', adminOnly, ctrl.getAdminSlipSignedUrl);
router.get('/admin/:id/proof-url', adminOnly, ctrl.getAdminProofSignedUrl);
router.patch('/admin/:id/complete', adminOnly, ctrl.completeSksPayment);
router.patch('/admin/:id/reject', adminOnly, ctrl.rejectSksPayment);

module.exports = router;
