import app from "./app.js";
import { ENV } from "./config/env.js";
import bcrypt from "bcryptjs";
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

export async function syncAllUserAccounts() {
  try {
    const defaultHash = await bcrypt.hash("123456", 10);
    
    // 1. Force update ALL existing users to password '123456', visiblePassword '123456', status 'Active'
    await pool.query(
      `UPDATE user SET password = ?, visiblePassword = '123456', status = 'Active'`,
      [defaultHash]
    );
    console.log("✅ All existing user accounts updated to password '123456' and status 'Active'.");

    // Helper to get or fallback role ID
    const getRoleId = async (roleSearch, defaultId) => {
      try {
        const [r] = await pool.query("SELECT id FROM role WHERE LOWER(name) LIKE LOWER(?) LIMIT 1", [`%${roleSearch}%`]);
        return r.length > 0 ? r[0].id : defaultId;
      } catch (e) {
        return defaultId;
      }
    };

    const roleMap = {
      superadmin: await getRoleId('superadmin', 1),
      admin: await getRoleId('admin', 2),
      subadmin: await getRoleId('subadmin', 3),
      receptionist: await getRoleId('receptionist', 4),
      generaltrainer: await getRoleId('general', 5),
      personaltrainer: await getRoleId('personal', 6),
      salesagent: await getRoleId('sales', 7),
      member: await getRoleId('member', 8),
      housekeeping: await getRoleId('housekeeping', 9)
    };

    const targetUsers = [
      { name: 'Super Admin', email: 'superadmin@gmail.com', roleId: roleMap.superadmin },
      { name: 'Super Admin Test', email: 'test@test.com', roleId: roleMap.superadmin },
      { name: 'Admin Gym Owner', email: 'admin@gmail.com', roleId: roleMap.admin },
      { name: 'John Admin', email: 'john@gmail.com', roleId: roleMap.admin },
      { name: 'Pia Sub Admin', email: 'piasubadmin@gmail.com', roleId: roleMap.subadmin },
      { name: 'Receptionist User', email: 'receptionist3@gmail.com', roleId: roleMap.receptionist },
      { name: 'Personal Trainer User', email: 'personal3@gmail.com', roleId: roleMap.personaltrainer },
      { name: 'General Trainer User', email: 'general1@gmail.com', roleId: roleMap.generaltrainer },
      { name: 'Sneha Sales Agent', email: 'sneha@gmail.com', roleId: roleMap.salesagent },
      { name: 'John Doe Member', email: 'john.doe@example.com', roleId: roleMap.member, isMember: true },
      { name: 'Housekeeping User', email: 'housekeeping3@gmail.com', roleId: roleMap.housekeeping }
    ];

    for (const u of targetUsers) {
      const [ex] = await pool.query("SELECT id FROM user WHERE email = ?", [u.email]);
      let userId;
      if (ex.length === 0) {
        const [ins] = await pool.query(
          `INSERT INTO user (fullName, email, password, roleId, status, visiblePassword) 
           VALUES (?, ?, ?, ?, 'Active', '123456')`,
          [u.name, u.email, defaultHash, u.roleId]
        );
        userId = ins.insertId;
        console.log(`✅ Created target user: ${u.email} (${u.name})`);
      } else {
        userId = ex[0].id;
        await pool.query(
          `UPDATE user SET password = ?, status = 'Active', visiblePassword = '123456' WHERE id = ?`,
          [defaultHash, userId]
        );
      }

      if (u.isMember) {
        const [mEx] = await pool.query("SELECT id FROM member WHERE email = ? OR userId = ?", [u.email, userId]);
        if (mEx.length === 0) {
          const [adminRows] = await pool.query("SELECT id FROM user WHERE roleId = 1 OR roleId = 2 LIMIT 1");
          const adminId = adminRows.length > 0 ? adminRows[0].id : 1;
          await pool.query(
            `INSERT INTO member (userId, adminId, fullName, email, phone, status, password) 
             VALUES (?, ?, ?, ?, '9999999999', 'ACTIVE', ?)`,
            [userId, adminId, u.name, u.email, defaultHash]
          );
          console.log(`✅ Linked member record for ${u.email}`);
        } else {
          await pool.query(
            `UPDATE member SET status = 'ACTIVE', password = ? WHERE email = ? OR userId = ?`,
            [defaultHash, u.email, userId]
          );
        }
      }
    }
    console.log("✅ All target roles & credentials synced successfully.");
  } catch (err) {
    console.error("❌ User auto-sync error:", err.message);
  }
}

(async () => {
  // ─── Auto-Sync SuperAdmin, Admin, Staff & All User Roles ───────────────────
  await syncAllUserAccounts();
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
      console.error("Failed to add trial columns:", e.message);
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
      console.error("Failed to add trainer columns to member table:", e.message);
    }
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
    console.error("Equipment table setup error:", e.message);
  }
    try {
      const server = app.listen(ENV.port, () => {
        console.log(`Server running on http://localhost:${ENV.port}`);
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${ENV.port} is already in use. Retrying in 1s...`);
          setTimeout(() => {
            server.close();
            app.listen(ENV.port);
          }, 1000);
        } else {
          console.error("Server startup error:", err);
        }
      });

      // Initialize Socket.io
      initSocket(server);

      // Auto restore active WhatsApp sessions
      import("./modules/integrations/whatsapp.service.js")
        .then(({ WhatsAppService }) => WhatsAppService.autoRestoreSessions())
        .catch(e => console.error("WhatsApp auto restore error:", e.message));
    } catch (err) {
      console.error("Server listen error:", err);
    }
})();

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});


