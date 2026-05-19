const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const ctrl = require('../controllers/userController');

router.use(auth);
router.get('/admin/all', adminOnly, ctrl.listUsers);
router.patch('/admin/salut/bulk', adminOnly, ctrl.bulkUpdateUserSalut);
// SALUT application management (static routes before /:userId wildcard)
router.get('/admin/salut/applications', adminOnly, ctrl.listSalutApplications);
router.get('/admin/salut/proof-url/:userId', adminOnly, ctrl.getSalutProofUrl);
router.patch('/admin/:userId/salut/approve', adminOnly, ctrl.approveSalutApplication);
router.patch('/admin/:userId/salut/reject', adminOnly, ctrl.rejectSalutApplication);
router.patch('/admin/:userId/salut', adminOnly, ctrl.updateUserSalut);

module.exports = router;
