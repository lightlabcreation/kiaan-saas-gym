import cron from 'node-cron';
import {
  getBackupSettings,
  generateCompleteBackupPackage
} from '../modules/backup/backup.service.js';

/**
 * Initialize Backup Scheduler Cron
 * Checks every 30 minutes if an automatic backup is due
 */
export const initBackupCronJob = () => {
  console.log('⏰ Initializing Automatic System Backup Scheduler (Cron)...');

  cron.schedule('*/30 * * * *', async () => {
    try {
      const settings = await getBackupSettings();
      if (!settings || !settings.automaticBackupEnabled) {
        return;
      }

      const now = new Date();
      const nextDue = settings.nextBackupAt ? new Date(settings.nextBackupAt) : null;

      // Check if backup is due
      if (!nextDue || now >= nextDue) {
        console.log('🛡️ [Backup Scheduler] Automatic backup is due! Starting backup generation...');
        const backupResult = await generateCompleteBackupPackage({
          type: 'Automatic',
          createdBy: 'System Scheduler (Cron)'
        });
        console.log(`✅ [Backup Scheduler] Automatic backup completed successfully: ${backupResult.filename} (${backupResult.sizeFormatted})`);
      }
    } catch (err) {
      console.error('❌ [Backup Scheduler Error]:', err.message);
    }
  });
};
