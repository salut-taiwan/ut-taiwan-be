const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/authController');
const { asyncHandler } = require('../utils/asyncHandler');

router.post('/register', asyncHandler(ctrl.register));
router.post('/login', asyncHandler(ctrl.login));
router.post('/refresh', asyncHandler(ctrl.refresh));
router.post('/resend-verification', asyncHandler(ctrl.resendVerification));
router.post('/logout', auth, asyncHandler(ctrl.logout));
router.get('/me', auth, asyncHandler(ctrl.getMe));
router.put('/me', auth, asyncHandler(ctrl.updateMe));

module.exports = router;
