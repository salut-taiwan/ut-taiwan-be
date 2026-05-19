const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/salutController');

router.use(auth);
router.post('/upload-proof', upload.single('proof'), ctrl.uploadProof);
router.post('/apply', ctrl.applyForMembership);
router.get('/status', ctrl.getApplicationStatus);

module.exports = router;
