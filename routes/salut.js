const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const requireVerified = require('../middleware/requireVerified');
const ctrl = require('../controllers/salutController');

router.use(auth);
router.post('/upload-proof', upload.single('proof'), ctrl.uploadProof);
router.post('/apply', requireVerified, ctrl.applyForMembership);
router.get('/status', ctrl.getApplicationStatus);

module.exports = router;
