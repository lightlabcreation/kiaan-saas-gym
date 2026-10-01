import fs from 'fs';
import path from 'path';
import {
  BACKUP_DIR,
  getBackupSettings as getSettingsService,
  updateBackupSettings as updateSettingsService,
  generateCompleteBackupPackage,
  listBackupsHistory as listBackupsService,
  deleteBackup as deleteBackupService,
  restoreDatabaseFromBackup,
  sendBackupNotificationEmail
} from './backup.service.js';
import { logAudit } from '../auditLog/auditLog.service.js';

export const getSettings = async (req, res, next) => {
  try {
    const settings = await getSettingsService();
    return res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req, res, next) => {
  try {
    const updated = await updateSettingsService(req.body);

    logAudit({
      req,
      adminId: req.user?.adminId || req.user?.id,
      action: "BACKUP_SETTINGS_UPDATE",
      module: "SYSTEM_BACKUP",
      resourceType: "BackupSettings",
      description: "Updated automated backup frequency, time, and retention policies",
      status: "SUCCESS",
      severity: "INFO",
      newValue: req.body
    });

    return res.status(200).json({
      success: true,
      message: 'Backup settings updated successfully.',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

export const listBackups = async (req, res, next) => {
  try {
    const backups = await listBackupsService();
    const settings = await getSettingsService();
    return res.status(200).json({
      success: true,
      count: backups.length,
      data: backups,
      settings: settings
    });
  } catch (error) {
    next(error);
  }
};

export const createBackup = async (req, res, next) => {
  try {
    const { type = 'Manual' } = req.body;
    const actorUser = req.user?.fullName || req.user?.email || 'Admin';

    const result = await generateCompleteBackupPackage({
      type: type,
      createdBy: actorUser
    });

    logAudit({
      req,
      adminId: req.user?.adminId || req.user?.id,
      action: "BACKUP_CREATE",
      module: "SYSTEM_BACKUP",
      resourceType: "BackupPackage",
      resourceId: result.package?.filename,
      description: `Created complete ${type} system backup archive (${result.package?.filename})`,
      status: "SUCCESS",
      severity: "INFO",
      newValue: { filename: result.package?.filename, sizeBytes: result.package?.sizeBytes }
    });

    return res.status(201).json({
      success: true,
      message: 'Complete backup package generated successfully!',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const sendBackupEmail = async (req, res, next) => {
  try {
    const { email } = req.body;
    const settings = await getSettingsService();
    const targetEmail = email || settings?.adminEmail;

    if (!targetEmail) {
      return res.status(400).json({ success: false, message: 'Admin email address is required.' });
    }

    const backups = await listBackupsService();
    const latest = backups.find(b => b.status === 'Success') || backups[0];

    if (!latest) {
      return res.status(404).json({ success: false, message: 'No backup package available to send.' });
    }

    await sendBackupNotificationEmail({
      backupRecord: latest,
      adminEmail: targetEmail,
      isSuccess: true
    });

    return res.status(200).json({
      success: true,
      message: `Backup notification sent successfully to ${targetEmail}.`
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to send backup email notification.'
    });
  }
};

export const downloadBackup = async (req, res, next) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filePath = path.join(BACKUP_DIR, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Backup file not found on server.' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', 'application/zip');

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    next(error);
  }
};

export const deleteBackup = async (req, res, next) => {
  try {
    const { filename } = req.params;
    const result = await deleteBackupService(filename);

    logAudit({
      req,
      adminId: req.user?.adminId || req.user?.id,
      action: "BACKUP_DELETE",
      module: "SYSTEM_BACKUP",
      resourceType: "BackupPackage",
      resourceId: filename,
      description: `Deleted backup archive ${filename}`,
      status: "SUCCESS",
      severity: "WARNING"
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const restoreBackup = async (req, res, next) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ success: false, message: 'Backup filename is required for restoration.' });
    }

    const result = await restoreDatabaseFromBackup(filename, req.user || {});

    logAudit({
      req,
      adminId: req.user?.adminId || req.user?.id,
      action: "BACKUP_RESTORE",
      module: "SYSTEM_BACKUP",
      resourceType: "BackupPackage",
      resourceId: filename,
      description: `Restored entire MySQL database and system state from backup archive: ${filename}`,
      status: "SUCCESS",
      severity: "CRITICAL"
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Backup restoration failed.'
    });
  }
};

export const uploadBackup = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No backup file provided in request.' });
    }

    const { filename, size } = req.file;
    return res.status(200).json({
      success: true,
      message: 'Backup archive uploaded successfully.',
      filename,
      sizeBytes: size
    });
  } catch (error) {
    next(error);
  }
};
