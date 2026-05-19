const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const ctrl = require('../controllers/userController');

router.use(auth);
router.get('/admin/all', adminOnly, ctrl.listUsers);
router.patch('/admin/salut/bulk', adminOnly, ctrl.bulkUpdateUserSalut);
router.patch('/admin/:userId/salut', adminOnly, ctrl.updateUserSalut);

module.exports = router;
