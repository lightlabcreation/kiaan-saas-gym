import express from 'express';
import path from 'path';
import { createRequire } from 'module';
import { BACKUP_DIR } from './backup.service.js';

const require = createRequire(import.meta.url);
const multer = require('multer');
import {
  getSettings,
  updateSettings,
  listBackups,
  createBackup,
  sendBackupEmail,
  downloadBackup,
  deleteBackup,
  restoreBackup,
  uploadBackup
} from './backup.controller.js';
import { verifyToken } from '../../middlewares/auth.js';

const backupStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BACKUP_DIR),
  filename: (req, file, cb) => cb(null, path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const backupUpload = multer({
  storage: backupStorage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB limit
});

const router = express.Router();
const auth = verifyToken(['Superadmin', 'Admin']);

router.get('/settings', auth, getSettings);
router.put('/settings', auth, updateSettings);
router.get('/', auth, listBackups);
router.post('/create', auth, createBackup);
router.post('/send-email', auth, sendBackupEmail);
router.post('/upload', auth, backupUpload.single('backupFile'), uploadBackup);
router.get('/download/:filename', auth, downloadBackup);
router.delete('/:filename', auth, deleteBackup);
router.post('/restore', auth, restoreBackup);

export default router;
