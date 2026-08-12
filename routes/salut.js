const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const requireVerified = require('../middleware/requireVerified');
const ctrl = require('../controllers/salutController');
const { asyncHandler } = require('../utils/asyncHandler');

router.use(auth);
router.post('/upload-proof', upload.single('proof'), asyncHandler(ctrl.uploadProof));
router.post('/apply', requireVerified, asyncHandler(ctrl.applyForMembership));
router.get('/status', asyncHandler(ctrl.getApplicationStatus));

module.exports = router;
