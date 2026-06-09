const express = require('express');
const router = express.Router();
const { userStatusStream } = require('../controllers/sseController');
const { authenticateSSE } = require('../middleware/auth');

router.get('/status', authenticateSSE, userStatusStream);

module.exports = router;
