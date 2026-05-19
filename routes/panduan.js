const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/panduanController');

router.get('/', ctrl.getCategories);

module.exports = router;
