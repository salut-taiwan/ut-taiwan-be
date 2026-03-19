const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const ctrl = require('../controllers/scraperController');

router.use(auth, adminOnly);

router.post('/run', ctrl.triggerRun);
router.post('/run-prefixes', ctrl.triggerPrefixRun);
router.get('/runs', ctrl.listRuns);
router.get('/runs/:id', ctrl.getRun);

module.exports = router;
