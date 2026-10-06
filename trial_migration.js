import { pool } from "./src/config/db.js";

async function runMigration() {
  try {
    console.log("🚀 Starting database migration checks...");

    // Helper to safely execute ALTER TABLE ADD COLUMN statements
    const safeAddColumn = async (table, columnDef) => {
      try {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
        console.log(`✅ [${table}] Added column: ${columnDef.split(" ")[0]}`);
      } catch (err) {
        if (err.code === "ER_DUP_FIELDNAME" || err.message?.includes("Duplicate column")) {
          // Already exists
        } else {
          console.warn(`⚠️ [${table}] Column notice: ${err.message}`);
        }
      }
    };

    // 1. Add Trial and Razorpay Columns to User table
    console.log("Checking user table columns...");
    await safeAddColumn("user", "trialStartDate DATETIME DEFAULT NULL");
    await safeAddColumn("user", "trialEndDate DATETIME DEFAULT NULL");
    await safeAddColumn("user", "trialStatus ENUM('Active', 'Expired', 'Converted', 'None') DEFAULT 'None'");
    await safeAddColumn("user", "gracePeriodEndDate DATETIME DEFAULT NULL");
    await safeAddColumn("user", "razorpayKeyId VARCHAR(255) DEFAULT NULL");
    await safeAddColumn("user", "razorpayKeySecret VARCHAR(255) DEFAULT NULL");

    // 2. Create Automation Settings Table
    console.log("Checking automation_settings table...");
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

    // 3. Add Manual Payment Columns to Payment table
    console.log("Checking payment table columns...");
    await safeAddColumn("payment", "paymentMode VARCHAR(50) DEFAULT 'Cash'");
    await safeAddColumn("payment", "transactionId VARCHAR(100) DEFAULT NULL");
    await safeAddColumn("payment", "paymentProofImage VARCHAR(500) DEFAULT NULL");
    await safeAddColumn("payment", "status VARCHAR(50) DEFAULT 'Approved'");
    await safeAddColumn("payment", "rejectionRemarks TEXT DEFAULT NULL");

    // 4. Ensure tenantintegrationsettings table exists
    console.log("Checking tenantintegrationsettings table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenantintegrationsettings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        tenantId INT NOT NULL UNIQUE,
        paymentGatewayEnabled BOOLEAN DEFAULT false,
        emailEnabled BOOLEAN DEFAULT false,
        whatsappEnabled BOOLEAN DEFAULT false,
        isVerified TINYINT(1) DEFAULT 0,
        lastVerifiedAt DATETIME NULL,
        lastTestStatus VARCHAR(50) NULL,
        lastTestMessage TEXT NULL,
        razorpayKeyId VARCHAR(255) NULL,
        razorpaySecret VARCHAR(255) NULL,
        brevoApiKey VARCHAR(255) NULL,
        brevoSenderEmail VARCHAR(255) NULL,
        brevoSenderName VARCHAR(255) NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Add UPI, WhatsApp and SMTP columns individually
    const integrationCols = [
      "upiQrCode VARCHAR(500) DEFAULT NULL",
      "upiId VARCHAR(255) DEFAULT NULL",
      "upiAccountHolder VARCHAR(255) DEFAULT NULL",
      "paymentInstructions TEXT DEFAULT NULL",
      "whatsappNumber VARCHAR(50) DEFAULT NULL",
      "whatsappStatus VARCHAR(50) DEFAULT 'DISCONNECTED'",
      "whatsappQr LONGTEXT DEFAULT NULL",
      "whatsappConnectedAt DATETIME DEFAULT NULL",
      "whatsappLastError TEXT DEFAULT NULL",
      "smtpHost VARCHAR(255) DEFAULT 'smtp.gmail.com'",
      "smtpPort INT DEFAULT 587",
      "smtpUsername VARCHAR(255) DEFAULT NULL",
      "smtpPassword VARCHAR(500) DEFAULT NULL",
      "smtpEncryption VARCHAR(50) DEFAULT 'STARTTLS'",
      "smtpEnabled TINYINT(1) DEFAULT 0",
      "smtpProvider VARCHAR(50) DEFAULT 'gmail'"
    ];

    for (const colDef of integrationCols) {
      await safeAddColumn("tenantintegrationsettings", colDef);
    }

    console.log("🎉 Database migrations completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration error:", error.message);
    process.exit(1);
  }
}

runMigration();
