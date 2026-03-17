const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/catalogController');

router.get('/faculties', ctrl.listFaculties);
router.get('/faculties/:id/programs', ctrl.listProgramsByFaculty);
router.get('/programs', ctrl.listPrograms);
router.get('/programs/:id', ctrl.getProgram);
router.get('/programs/:id/subjects', ctrl.listSubjects);
router.get('/subjects/:id', ctrl.getSubject);

module.exports = router;
