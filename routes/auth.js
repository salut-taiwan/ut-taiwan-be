const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/logout', auth, ctrl.logout);
router.get('/me', auth, ctrl.getMe);
router.put('/me', auth, ctrl.updateMe);

module.exports = router;
