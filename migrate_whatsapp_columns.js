import { pool } from "./src/config/db.js";

async function addColumns() {
  console.log("🚀 Running WhatsApp & Integrations database migration for Live DB...");

  const queries = [
    "ALTER TABLE tenantintegrationsettings ADD COLUMN whatsappNumber VARCHAR(50) DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN whatsappStatus VARCHAR(50) DEFAULT 'DISCONNECTED'",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN whatsappQr LONGTEXT DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN whatsappConnectedAt DATETIME DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN whatsappLastError TEXT DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN smtpHost VARCHAR(255) DEFAULT 'smtp.gmail.com'",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN smtpPort INT DEFAULT 587",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN smtpUsername VARCHAR(255) DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN smtpPassword VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN smtpEncryption VARCHAR(50) DEFAULT 'STARTTLS'",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN smtpEnabled TINYINT(1) DEFAULT 0",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN smtpProvider VARCHAR(50) DEFAULT 'gmail'",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN upiQrCode VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN upiId VARCHAR(255) DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN upiAccountHolder VARCHAR(255) DEFAULT NULL",
    "ALTER TABLE tenantintegrationsettings ADD COLUMN paymentInstructions TEXT DEFAULT NULL"
  ];

  for (const q of queries) {
    try {
      await pool.query(q);
      console.log(`✅ Executed: ${q}`);
    } catch (err) {
      if (err.code === "ER_DUP_FIELDNAME" || err.message?.includes("Duplicate column")) {
        console.log(`ℹ️ Column already exists, skipped.`);
      } else {
        console.error(`⚠️ Notice: ${err.message}`);
      }
    }
  }

  console.log("🎉 Migration completed successfully!");
  process.exit(0);
}

addColumns();
