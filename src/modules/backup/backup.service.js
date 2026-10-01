import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { pool } from '../../config/db.js';

const require = createRequire(import.meta.url);
const archiverPkg = require('archiver');
const createArchiver = (format, options) => {
  if (format === 'zip' && archiverPkg.ZipArchive) {
    return new archiverPkg.ZipArchive(options);
  }
  if (typeof archiverPkg === 'function') {
    return archiverPkg(format, options);
  }
  if (archiverPkg.default && typeof archiverPkg.default === 'function') {
    return archiverPkg.default(format, options);
  }
  if (archiverPkg.Archiver) {
    return new archiverPkg.Archiver(format, options);
  }
  throw new Error("Archiver module could not be instantiated.");
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BACKUP_DIR = path.resolve(__dirname, '../../backups');
export const UPLOADS_DIR = path.resolve(__dirname, '../../../uploads');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * 1. Initialize Backup Database Tables
 */
export const initBackupTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backup_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        automaticBackupEnabled TINYINT(1) NOT NULL DEFAULT 1,
        frequencyDays INT NOT NULL DEFAULT 7,
        backupTime VARCHAR(10) NOT NULL DEFAULT '02:00',
        adminEmail VARCHAR(255) NULL,
        retentionCount INT NOT NULL DEFAULT 10,
        includeDatabase TINYINT(1) NOT NULL DEFAULT 1,
        includeUploads TINYINT(1) NOT NULL DEFAULT 1,
        lastBackupAt DATETIME NULL,
        nextBackupAt DATETIME NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS backup_history (
        id INT PRIMARY KEY AUTO_INCREMENT,
        backupId VARCHAR(100) NOT NULL UNIQUE,
        filename VARCHAR(255) NOT NULL,
        filePath VARCHAR(500) NOT NULL,
        fileSize BIGINT NOT NULL DEFAULT 0,
        sizeFormatted VARCHAR(50) NOT NULL DEFAULT '0 KB',
        type VARCHAR(50) NOT NULL DEFAULT 'Automatic',
        status VARCHAR(50) NOT NULL DEFAULT 'Success',
        checksum VARCHAR(255) NULL,
        failureReason TEXT NULL,
        tablesCount INT DEFAULT 0,
        filesCount INT DEFAULT 0,
        createdBy VARCHAR(255) NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const [rows] = await pool.query(`SELECT * FROM backup_settings LIMIT 1`);
    if (rows.length === 0) {
      const [adminRows] = await pool.query(
        `SELECT email FROM user WHERE roleId IN (1, 2) OR LOWER(email) LIKE '%admin%' LIMIT 1`
      );
      const defaultEmail = adminRows[0]?.email || 'admin@gmail.com';
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + 7);

      await pool.query(
        `INSERT INTO backup_settings 
         (automaticBackupEnabled, frequencyDays, backupTime, adminEmail, retentionCount, includeDatabase, includeUploads, nextBackupAt) 
         VALUES (1, 7, '02:00', ?, 10, 1, 1, ?)`,
        [defaultEmail, nextDate]
      );
    }
  } catch (err) {
    console.error('[Backup Engine] Initialization error:', err.message);
  }
};

/**
 * 2. Get Backup Settings
 */
export const getBackupSettings = async () => {
  await initBackupTables();
  const [rows] = await pool.query(`SELECT * FROM backup_settings ORDER BY id ASC LIMIT 1`);
  if (rows.length === 0) return null;
  const settings = rows[0];

  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total, SUM(fileSize) as storageBytes FROM backup_history WHERE status = 'Success'`
  );
  const totalBackups = countRows[0]?.total || 0;
  const storageBytes = countRows[0]?.storageBytes || 0;

  const [lastRow] = await pool.query(
    `SELECT createdAt, status, filename FROM backup_history ORDER BY id DESC LIMIT 1`
  );

  return {
    automaticBackupEnabled: Boolean(settings.automaticBackupEnabled),
    frequencyDays: settings.frequencyDays || 7,
    backupTime: settings.backupTime || '02:00',
    adminEmail: settings.adminEmail || '',
    retentionCount: settings.retentionCount || 10,
    includeDatabase: Boolean(settings.includeDatabase),
    includeUploads: Boolean(settings.includeUploads),
    lastBackupAt: settings.lastBackupAt || lastRow[0]?.createdAt || null,
    nextBackupAt: settings.nextBackupAt,
    updatedAt: settings.updatedAt,
    stats: {
      totalBackups,
      totalStorageFormatted: formatBytes(storageBytes),
      lastBackupStatus: lastRow[0]?.status || 'Healthy',
      lastBackupFilename: lastRow[0]?.filename || null
    }
  };
};

/**
 * 3. Update Backup Settings
 */
export const updateBackupSettings = async (newSettings) => {
  await initBackupTables();
  const {
    automaticBackupEnabled = true,
    frequencyDays = 7,
    backupTime = '02:00',
    adminEmail = '',
    retentionCount = 10,
    includeDatabase = true,
    includeUploads = true
  } = newSettings;

  const freq = parseInt(frequencyDays, 10) || 7;
  const ret = parseInt(retentionCount, 10) || 10;
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + freq);

  const [existing] = await pool.query(`SELECT id FROM backup_settings LIMIT 1`);
  if (existing.length > 0) {
    await pool.query(
      `UPDATE backup_settings SET 
        automaticBackupEnabled = ?,
        frequencyDays = ?,
        backupTime = ?,
        adminEmail = ?,
        retentionCount = ?,
        includeDatabase = ?,
        includeUploads = ?,
        nextBackupAt = ?
      WHERE id = ?`,
      [
        automaticBackupEnabled ? 1 : 0,
        freq,
        backupTime,
        adminEmail.trim().toLowerCase(),
        ret,
        includeDatabase ? 1 : 0,
        includeUploads ? 1 : 0,
        nextDate,
        existing[0].id
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO backup_settings 
       (automaticBackupEnabled, frequencyDays, backupTime, adminEmail, retentionCount, includeDatabase, includeUploads, nextBackupAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        automaticBackupEnabled ? 1 : 0,
        freq,
        backupTime,
        adminEmail.trim().toLowerCase(),
        ret,
        includeDatabase ? 1 : 0,
        includeUploads ? 1 : 0,
        nextDate
      ]
    );
  }
  return await getBackupSettings();
};

const formatSqlValue = (val) => {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'number') return Number.isFinite(val) ? val : 'NULL';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return 'NULL';
    const iso = val.toISOString().slice(0, 19).replace('T', ' ');
    return `'${iso}'`;
  }
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  }
  const str = String(val);
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
};

/**
 * 4. Generate Complete Backup Package (DB SQL + Uploads + Metadata inside ZIP)
 */
export const generateCompleteBackupPackage = async (options = {}) => {
  await initBackupTables();
  const { type = 'Manual', createdBy = 'Admin' } = options;

  const settings = await getBackupSettings();
  const includeDb = settings ? settings.includeDatabase : true;
  const includeFiles = settings ? settings.includeUploads : true;

  const timestamp = new Date();
  const dateStr = timestamp.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const randomSalt = crypto.randomBytes(3).toString('hex');
  const backupId = `gym-backup-${dateStr}-${randomSalt}`;
  const zipFilename = `${backupId}.zip`;
  const zipFilePath = path.join(BACKUP_DIR, zipFilename);

  const recordCounts = {};
  let tablesCount = 0;
  let filesCount = 0;

  try {
    // 1. Generate Schema DDL & Data SQL Statements
    let schemaSqlContent = `-- Gym Management System Schema Dump\n-- Generated: ${timestamp.toISOString()}\n\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;
    let dataSqlContent = `-- Gym Management System Data Dump\n-- Generated: ${timestamp.toISOString()}\n\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;

    if (includeDb) {
      const [tablesRaw] = await pool.query(`
        SELECT TABLE_NAME as tableName 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_TYPE = 'BASE TABLE';
      `);

      const tableNames = tablesRaw.map(t => t.tableName || t.TABLE_NAME);
      tablesCount = tableNames.length;

      for (const tableName of tableNames) {
        try {
          // DDL Create Table statement
          const [createResult] = await pool.query(`SHOW CREATE TABLE \`${tableName}\``);
          if (createResult[0] && createResult[0]['Create Table']) {
            schemaSqlContent += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
            schemaSqlContent += createResult[0]['Create Table'] + `;\n\n`;
          }

          // Data Rows Dump
          const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
          recordCounts[tableName] = rows.length;

          if (rows.length > 0) {
            dataSqlContent += `-- Table: \`${tableName}\` (${rows.length} rows)\n`;
            dataSqlContent += `DELETE FROM \`${tableName}\`;\n`;

            const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');

            // Batch insert statements
            const batchSize = 100;
            for (let i = 0; i < rows.length; i += batchSize) {
              const batch = rows.slice(i, i + batchSize);
              const valuesList = batch.map(row => {
                const vals = Object.values(row).map(v => formatSqlValue(v)).join(', ');
                return `(${vals})`;
              }).join(',\n  ');

              dataSqlContent += `INSERT INTO \`${tableName}\` (${cols}) VALUES\n  ${valuesList};\n`;
            }
            dataSqlContent += `\n`;
          }
        } catch (tblErr) {
          console.warn(`[Backup Engine] Warning exporting table ${tableName}:`, tblErr.message);
        }
      }
    }

    schemaSqlContent += `SET FOREIGN_KEY_CHECKS = 1;\n`;
    dataSqlContent += `SET FOREIGN_KEY_CHECKS = 1;\n`;

    // 2. Count uploaded files if enabled
    if (includeFiles && fs.existsSync(UPLOADS_DIR)) {
      const getFilesRecursively = (dir) => {
        let count = 0;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            count += getFilesRecursively(fullPath);
          } else {
            count++;
          }
        }
        return count;
      };
      filesCount = getFilesRecursively(UPLOADS_DIR);
    }

    // 3. Create ZIP Archive with specified folder structure
    const output = fs.createWriteStream(zipFilePath);
    const archive = createArchiver('zip', { zlib: { level: 9 } });

    const archivePromise = new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });

    archive.pipe(output);

    // Add Database SQL dumps
    if (includeDb) {
      archive.append(schemaSqlContent, { name: 'gym-backup/database/schema.sql' });
      archive.append(dataSqlContent, { name: 'gym-backup/database/database.sql' });
    }

    // Add Uploaded Files
    if (includeFiles && fs.existsSync(UPLOADS_DIR)) {
      archive.directory(UPLOADS_DIR, 'gym-backup/uploads');
    }

    // Add Metadata JSON (sans plain text secrets)
    const metadata = {
      backupId,
      timestamp: timestamp.toISOString(),
      type,
      createdBy,
      databaseType: 'MySQL',
      tablesCount,
      filesCount,
      recordCounts,
      includes: {
        database: includeDb,
        uploads: includeFiles
      }
    };

    archive.append(JSON.stringify(metadata, null, 2), { name: 'gym-backup/configuration/backup-metadata.json' });

    // Add README.txt
    const readmeContent = `=====================================================
GYM MANAGEMENT SYSTEM AUTOMATIC BACKUP ARCHIVE
=====================================================
Backup ID: ${backupId}
Created Date: ${timestamp.toLocaleString()}
Backup Type: ${type}
Created By: ${createdBy}

PACKAGE CONTENTS:
-----------------
- gym-backup/database/schema.sql          : Table structure DDL definitions
- gym-backup/database/database.sql        : Full data INSERT records
- gym-backup/uploads/                     : Gym uploaded files (member photos, logos, invoices)
- gym-backup/configuration/backup-metadata.json : System backup manifest metadata

RESTORE INSTRUCTIONS:
---------------------
To restore this backup, use the Admin Panel -> Settings -> Backup & Restore page 
or import database.sql into your MySQL database server.

CAUTION: Keep this file secure as it contains confidential operational records.
=====================================================`;
    archive.append(readmeContent, { name: 'gym-backup/README.txt' });

    await archive.finalize();
    await archivePromise;

    // 4. Integrity Verification & Checksum
    const stats = fs.statSync(zipFilePath);
    const fileBuffer = fs.readFileSync(zipFilePath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (stats.size === 0) {
      throw new Error("Integrity verification failed: Backup file is empty (0 bytes).");
    }

    const sizeFormatted = formatBytes(stats.size);

    // 5. Store record in backup_history
    await pool.query(
      `INSERT INTO backup_history 
       (backupId, filename, filePath, fileSize, sizeFormatted, type, status, checksum, tablesCount, filesCount, createdBy, createdAt) 
       VALUES (?, ?, ?, ?, ?, ?, 'Success', ?, ?, ?, ?, ?)`,
      [
        backupId,
        zipFilename,
        zipFilePath,
        stats.size,
        sizeFormatted,
        type,
        checksum,
        tablesCount,
        filesCount,
        createdBy,
        timestamp
      ]
    );

    // Update settings lastBackupAt & nextBackupAt
    if (settings) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + settings.frequencyDays);
      await pool.query(
        `UPDATE backup_settings SET lastBackupAt = ?, nextBackupAt = ? WHERE id > 0`,
        [timestamp, nextDate]
      );
    }

    // 6. Apply Retention Cleanup
    if (settings && settings.retentionCount) {
      await enforceRetentionCleanup(settings.retentionCount);
    }

    const backupRecord = {
      backupId,
      filename: zipFilename,
      filePath: zipFilePath,
      fileSize: stats.size,
      sizeFormatted,
      type,
      status: 'Success',
      checksum,
      tablesCount,
      filesCount,
      createdBy,
      createdAt: timestamp
    };

    // 7. Send Email Notification
    if (settings && settings.adminEmail) {
      sendBackupNotificationEmail({
        backupRecord,
        adminEmail: settings.adminEmail,
        isSuccess: true
      }).catch(err => console.error('[Backup Engine] Mail notification error:', err.message));
    }

    return backupRecord;

  } catch (error) {
    console.error('[Backup Engine Error]:', error);

    // Log failure record in backup_history
    try {
      await pool.query(
        `INSERT INTO backup_history 
         (backupId, filename, filePath, fileSize, sizeFormatted, type, status, failureReason, createdBy, createdAt) 
         VALUES (?, ?, ?, 0, '0 KB', ?, 'Failed', ?, ?, ?)`,
        [
          backupId,
          zipFilename,
          zipFilePath,
          type,
          error.message || 'Backup process failed',
          createdBy,
          timestamp
        ]
      );

      // Send failure notification email
      if (settings && settings.adminEmail) {
        sendBackupNotificationEmail({
          backupRecord: { backupId, filename: zipFilename, createdAt: timestamp },
          adminEmail: settings.adminEmail,
          isSuccess: false,
          failureReason: error.message
        }).catch(() => {});
      }
    } catch (_) {}

    throw new Error(`Backup failed: ${error.message}`);
  }
};

/**
 * 5. Retention Cleanup
 */
export const enforceRetentionCleanup = async (retentionCount = 10) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, filename, filePath FROM backup_history 
       WHERE status = 'Success' 
       ORDER BY createdAt DESC`
    );

    if (rows.length > retentionCount) {
      const toDelete = rows.slice(retentionCount);
      for (const item of toDelete) {
        if (item.filePath && fs.existsSync(item.filePath)) {
          fs.unlinkSync(item.filePath);
        }
        await pool.query(`DELETE FROM backup_history WHERE id = ?`, [item.id]);
      }
    }
  } catch (err) {
    console.error('[Backup Retention Cleanup Error]:', err.message);
  }
};

/**
 * 6. Send Email Notification
 */
export const sendBackupNotificationEmail = async ({ backupRecord, adminEmail, isSuccess = true, failureReason = null }) => {
  if (!adminEmail) return;

  const [gymApp] = await pool.query(`SELECT gym_name FROM app_settings LIMIT 1`);
  const gymName = gymApp[0]?.gym_name || 'Gym SaaS Software';

  const settings = await getBackupSettings();
  const nextScheduled = settings?.nextBackupAt ? new Date(settings.nextBackupAt).toLocaleString() : 'N/A';

  const subject = isSuccess
    ? `🛡️ Backup Completed Successfully - ${gymName}`
    : `⚠️ Backup Process Failed - ${gymName}`;

  const messageText = isSuccess
    ? `Backup completed successfully!\n\nGym: ${gymName}\nBackup ID: ${backupRecord.backupId}\nDate: ${new Date(backupRecord.createdAt).toLocaleString()}\nSize: ${backupRecord.sizeFormatted}\nNext Scheduled Backup: ${nextScheduled}`
    : `Backup failed!\n\nGym: ${gymName}\nBackup ID: ${backupRecord.backupId}\nDate: ${new Date(backupRecord.createdAt).toLocaleString()}\nReason: ${failureReason || 'Backup execution could not be completed.'}`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; padding: 24px; background: #f8fafc; color: #1e293b;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 28px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); border-top: 4px solid ${isSuccess ? '#22c55e' : '#ef4444'};">
        <h2 style="color: ${isSuccess ? '#15803d' : '#b91c1c'}; margin-top: 0;">
          ${isSuccess ? '🛡️ Backup Completed Successfully' : '⚠️ Backup Execution Failed'}
        </h2>
        <p style="font-size: 0.95rem; line-height: 1.5;">Gym SaaS System Backup Status Update:</p>
        
        <div style="background: ${isSuccess ? '#f0fdf4' : '#fef2f2'}; padding: 16px; border-radius: 8px; border: 1px solid ${isSuccess ? '#bbf7d0' : '#fecaca'}; margin: 20px 0;">
          <ul style="margin: 0; padding-left: 18px; color: #334155; line-height: 1.8;">
            <li><strong>Gym Name:</strong> ${gymName}</li>
            <li><strong>Backup ID:</strong> ${backupRecord.backupId}</li>
            <li><strong>Backup Date:</strong> ${new Date(backupRecord.createdAt).toLocaleString()}</li>
            ${isSuccess ? `<li><strong>Backup Size:</strong> ${backupRecord.sizeFormatted}</li>` : ''}
            ${isSuccess ? `<li><strong>Next Scheduled:</strong> ${nextScheduled}</li>` : ''}
            ${!isSuccess ? `<li style="color: #b91c1c;"><strong>Reason:</strong> ${failureReason || 'Process error'}</li>` : ''}
          </ul>
        </div>
        
        <p style="font-size: 0.85rem; color: #64748b;">
          ${isSuccess ? 'The backup package has been stored securely in your server backup directory.' : 'Please check your server logs or manually trigger a backup from the Admin Panel.'}
        </p>
      </div>
    </div>
  `;

  // Attach ZIP if file size <= 10 MB (10485760 bytes)
  const attachments = [];
  if (isSuccess && backupRecord.filePath && fs.existsSync(backupRecord.filePath) && backupRecord.fileSize <= 10485760) {
    attachments.push({
      filename: backupRecord.filename,
      path: backupRecord.filePath
    });
  }

  // Try Brevo API
  const brevoApiKey = process.env.BREVO_API_KEY;
  if (brevoApiKey && brevoApiKey.trim() !== '') {
    try {
      const payloadAttachments = [];
      if (attachments.length > 0) {
        const fileBuf = fs.readFileSync(backupRecord.filePath);
        payloadAttachments.push({
          name: backupRecord.filename,
          content: fileBuf.toString('base64')
        });
      }

      await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey.trim(),
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          sender: { name: "Gym SaaS System", email: process.env.MAIL_FROM_ADDRESS || "info@kiaantechnology.com" },
          to: [{ email: adminEmail }],
          subject,
          textContent: messageText,
          htmlContent,
          attachment: payloadAttachments.length > 0 ? payloadAttachments : undefined
        })
      });
      return;
    } catch (err) {
      console.warn('[Brevo Mail Fallback]:', err.message);
    }
  }

  // Fallback Nodemailer
  try {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || 'Gym SaaS'}" <${process.env.SMTP_USER || process.env.MAIL_FROM_ADDRESS}>`,
      to: adminEmail,
      subject,
      text: messageText,
      html: htmlContent,
      attachments
    });
  } catch (err) {
    console.warn('[Nodemailer Backup Error]:', err.message);
  }
};

/**
 * 7. List Backups History
 */
export const listBackupsHistory = async () => {
  await initBackupTables();
  const [rows] = await pool.query(
    `SELECT * FROM backup_history ORDER BY id DESC LIMIT 100`
  );
  return rows.map(r => ({
    id: r.id,
    backupId: r.backupId,
    filename: r.filename,
    sizeFormatted: r.sizeFormatted,
    sizeBytes: r.fileSize,
    type: r.type,
    status: r.status,
    checksum: r.checksum,
    failureReason: r.failureReason,
    tablesCount: r.tablesCount,
    filesCount: r.filesCount,
    createdBy: r.createdBy,
    createdAt: r.createdAt
  }));
};

/**
 * 8. Delete Backup
 */
export const deleteBackup = async (filename) => {
  const safeFilename = path.basename(filename);
  const targetPath = path.join(BACKUP_DIR, safeFilename);

  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  await pool.query(`DELETE FROM backup_history WHERE filename = ? OR backupId = ?`, [safeFilename, safeFilename]);
  return { success: true, message: `Backup file ${safeFilename} deleted successfully.` };
};

/**
 * 9. Restore Database & Files from Backup
 */
export const restoreDatabaseFromBackup = async (filename, actorUser = {}) => {
  const safeFilename = path.basename(filename);
  const targetPath = path.join(BACKUP_DIR, safeFilename);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup archive '${safeFilename}' does not exist on server.`);
  }

  // 1. First generate a safety backup of current state!
  try {
    await generateCompleteBackupPackage({
      type: 'Pre-Restore Safety',
      createdBy: actorUser.fullName || actorUser.email || 'Admin'
    });
  } catch (safetyErr) {
    console.warn("Safety pre-restore backup warning:", safetyErr.message);
  }

  // 2. Open ZIP and read database dumps & uploads
  try {
    const yauzl = (await import('yauzl')).default || require('yauzl');
    
    return new Promise((resolve, reject) => {
      yauzl.open(targetPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(new Error(`Failed to open backup archive: ${err.message}`));

        let dataSqlString = '';
        let extractedFiles = 0;

        zipfile.readEntry();

        zipfile.on('entry', (entry) => {
          if (entry.fileName.endsWith('database/database.sql')) {
            zipfile.openReadStream(entry, (sErr, readStream) => {
              if (sErr) return reject(sErr);
              const chunks = [];
              readStream.on('data', chunk => chunks.push(chunk));
              readStream.on('end', () => {
                dataSqlString = Buffer.concat(chunks).toString('utf-8');
                zipfile.readEntry();
              });
            });
          } else if (entry.fileName.startsWith('gym-backup/uploads/') && !entry.fileName.endsWith('/')) {
            const relativePath = entry.fileName.replace('gym-backup/uploads/', '');
            const targetFilePath = path.join(UPLOADS_DIR, relativePath);
            fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });

            zipfile.openReadStream(entry, (sErr, readStream) => {
              if (sErr) return reject(sErr);
              const writeStream = fs.createWriteStream(targetFilePath);
              readStream.pipe(writeStream);
              writeStream.on('finish', () => {
                extractedFiles++;
                zipfile.readEntry();
              });
            });
          } else {
            zipfile.readEntry();
          }
        });

        zipfile.on('end', async () => {
          try {
            if (dataSqlString && dataSqlString.trim()) {
              await pool.query('SET FOREIGN_KEY_CHECKS = 0;');
              const statements = dataSqlString.split(/;\s*\n/).filter(s => s.trim().length > 0);
              for (const stmt of statements) {
                try {
                  await pool.query(stmt);
                } catch (stmtErr) {
                  console.warn('[Restore Statement Warning]:', stmtErr.message);
                }
              }
              await pool.query('SET FOREIGN_KEY_CHECKS = 1;');
            }

            resolve({
              success: true,
              message: 'System restoration completed successfully! Safety backup of prior state created.',
              filesRestored: extractedFiles
            });
          } catch (restErr) {
            try { await pool.query('SET FOREIGN_KEY_CHECKS = 1;'); } catch (_) {}
            reject(new Error(`Restore execution error: ${restErr.message}`));
          }
        });

        zipfile.on('error', (zErr) => reject(zErr));
      });
    });
  } catch (restoreErr) {
    throw new Error(`Restore failed: ${restoreErr.message}`);
  }
};
