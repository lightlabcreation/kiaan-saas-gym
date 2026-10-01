import app from "./app.js";
import { ENV } from "./config/env.js";
import "./modules/alert/alert.corn.js";
import "./modules/notifications/notif.corn.js";
import { initTrialCronJobs } from "./cron/trial.cron.js";
import { initNotificationQueueCron } from "./cron/notificationQueue.cron.js";
import { initNotificationCleanupCron } from "./cron/notificationCleanup.cron.js";
import { initOtpCleanupCron } from "./cron/otpCleanup.cron.js";
import { initBackupCronJob } from "./cron/backup.cron.js";
import { initSocket } from "./config/socket.js";

import { pool } from "./config/db.js";

// Initialize scheduled tasks (local gymsaas_db connected)
initTrialCronJobs();
initNotificationQueueCron();
initNotificationCleanupCron();
initOtpCleanupCron();
initBackupCronJob();

// 1. Start HTTP server immediately so port is open without delay
try {
  const server = app.listen(ENV.port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${ENV.port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${ENV.port} is already in use. Retrying in 1s...`);
      setTimeout(() => {
        server.close();
        app.listen(ENV.port, "0.0.0.0");
      }, 1000);
    } else {
      console.error("Server startup error:", err);
    }
  });

  // Initialize Socket.io
  initSocket(server);
} catch (err) {
  console.error("Server listen error:", err);
}

// 2. Run schema setup and table migrations in background (non-blocking)
(async () => {
  try {
    await pool.query(`ALTER TABLE user 
      ADD COLUMN trialStartDate DATETIME DEFAULT NULL,
      ADD COLUMN trialEndDate DATETIME DEFAULT NULL,
      ADD COLUMN trialStatus ENUM('Active', 'Expired', 'Converted', 'None') DEFAULT 'None',
      ADD COLUMN gracePeriodEndDate DATETIME DEFAULT NULL;
    `);
    console.log("Trial columns added to user table successfully.");
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log("Trial columns already exist in user table.");
    } else {
      console.warn("Trial columns check:", e.message);
    }
  }

  try {
    await pool.query(`ALTER TABLE member 
      ADD COLUMN trainerId INT DEFAULT NULL,
      ADD COLUMN trainerType VARCHAR(255) DEFAULT NULL;
    `);
    console.log("Trainer columns added to member table successfully.");
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log("Trainer columns already exist in member table.");
    } else {
      console.warn("Trainer columns check:", e.message);
    }
  }

  // Automation settings table
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        trialDurationDays INT DEFAULT 7,
        gracePeriodDays INT DEFAULT 3,
        enableEmailNotif BOOLEAN DEFAULT false,
        enableWhatsappNotif BOOLEAN DEFAULT false,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    const [settings] = await pool.query("SELECT id FROM automation_settings");
    if (settings.length === 0) {
      await pool.query("INSERT INTO automation_settings (trialDurationDays, gracePeriodDays) VALUES (7, 3)");
    }
  } catch (e) {
    console.warn("automation_settings check:", e.message);
  }

  // Payment columns
  try {
    await pool.query(`ALTER TABLE payment 
      ADD COLUMN paymentMode VARCHAR(50) DEFAULT 'Cash',
      ADD COLUMN transactionId VARCHAR(100) DEFAULT NULL,
      ADD COLUMN paymentProofImage VARCHAR(500) DEFAULT NULL,
      ADD COLUMN status VARCHAR(50) DEFAULT 'Approved',
      ADD COLUMN rejectionRemarks TEXT DEFAULT NULL;
    `);
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') console.warn("Payment columns check:", e.message);
  }

  // Tenant integration UPI columns
  try {
    await pool.query(`ALTER TABLE tenantintegrationsettings 
      ADD COLUMN upiQrCode VARCHAR(500) DEFAULT NULL,
      ADD COLUMN upiId VARCHAR(255) DEFAULT NULL,
      ADD COLUMN upiAccountHolder VARCHAR(255) DEFAULT NULL,
      ADD COLUMN paymentInstructions TEXT DEFAULT NULL;
    `);
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') console.warn("UPI columns check:", e.message);
  }

  // ─── Ensure equipment tables exist (safe: IF NOT EXISTS) ──────────────────
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_equipment (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(255) NULL,
        quantity INT DEFAULT 1,
        \`condition\` VARCHAR(100) DEFAULT 'Good',
        purchaseDate DATE NULL,
        purchaseCost DECIMAL(10,2) NULL,
        location VARCHAR(255) NULL,
        nextMaintenanceDate DATE NULL,
        branchId INT NOT NULL,
        notes TEXT NULL,
        imageUrl TEXT NULL,
        isActive TINYINT(1) DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS equipment_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        requestedBy INT NOT NULL,
        role VARCHAR(100) DEFAULT 'MEMBER',
        itemName VARCHAR(255) NOT NULL,
        category VARCHAR(255) DEFAULT 'Other',
        quantity INT DEFAULT 1,
        reason TEXT NULL,
        branchId INT NULL,
        adminId INT NULL,
        imageUrl TEXT NULL,
        status VARCHAR(50) DEFAULT 'PENDING',
        adminRemarks TEXT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("Equipment tables ready.");
  } catch (e) {
    console.warn("Equipment table setup warning:", e.message);
  }
})();

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});


