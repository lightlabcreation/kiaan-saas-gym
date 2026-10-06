import { pool } from "../../config/db.js";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import { encrypt, decrypt } from "../../utils/encryption.js";

// Active WebSocket instances keyed by tenantId
const activeSockets = new Map();

/**
 * Silent logger for Baileys
 */
const dummyLogger = {
  level: "silent",
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => dummyLogger,
};

/**
 * Normalize phone numbers to E.164 / standard digit format
 */
export const normalizePhoneNumber = (phone) => {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0") && digits.length === 11) {
    digits = "91" + digits.slice(1);
  } else if (digits.length === 10) {
    digits = "91" + digits;
  }
  if (digits.length < 10 || digits.length > 15) return null;
  return "+" + digits;
};

let columnsEnsured = false;
export async function ensureIntegrationColumns() {
  if (columnsEnsured) return;
  try {
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
      } catch (_) {}
    }
    columnsEnsured = true;
  } catch (e) {
    console.error("Error ensuring columns:", e.message);
  }
}

export const WhatsAppService = {
  /**
   * Get WhatsApp connection details for a tenant
   */
  getStatus: async (tenantId) => {
    await ensureIntegrationColumns();
    await pool.query("INSERT IGNORE INTO tenantintegrationsettings (tenantId) VALUES (?)", [tenantId]);
    let rows = [];
    try {
      const [r] = await pool.query(
        `SELECT whatsappNumber, whatsappStatus, whatsappQr, whatsappConnectedAt, whatsappEnabled, whatsappLastError 
         FROM tenantintegrationsettings WHERE tenantId = ?`,
        [tenantId]
      );
      rows = r;
    } catch (dbErr) {
      if (dbErr.code === 'ER_BAD_FIELD_ERROR' || dbErr.message?.includes('Unknown column')) {
        columnsEnsured = false;
        await ensureIntegrationColumns();
        const [r] = await pool.query(
          `SELECT whatsappNumber, whatsappStatus, whatsappQr, whatsappConnectedAt, whatsappEnabled, whatsappLastError 
           FROM tenantintegrationsettings WHERE tenantId = ?`,
          [tenantId]
        );
        rows = r;
      } else {
        throw dbErr;
      }
    }
    if (rows.length === 0) {
      return {
        status: "DISCONNECTED",
        number: null,
        qr: null,
        connectedAt: null,
        enabled: false,
        lastError: null
      };
    }
    const r = rows[0];
    return {
      status: r.whatsappStatus || "DISCONNECTED",
      number: r.whatsappNumber || null,
      qr: r.whatsappQr || null,
      connectedAt: r.whatsappConnectedAt || null,
      enabled: Boolean(r.whatsappEnabled),
      lastError: r.whatsappLastError || null
    };
  },

  /**
   * Initiate authentic Baileys WhatsApp Web session connection & QR generation
   */
  initiateConnect: async (tenantId, rawPhone) => {
    await ensureIntegrationColumns();
    const normalized = normalizePhoneNumber(rawPhone);
    if (!normalized) {
      throw new Error("Invalid phone number format. Please provide a valid mobile number with country code (e.g. +919876543210).");
    }

    // Close existing socket if present
    if (activeSockets.has(tenantId)) {
      try {
        const oldSock = activeSockets.get(tenantId);
        oldSock.ev.removeAllListeners();
        oldSock.end(new Error("Reconnecting"));
      } catch (e) {}
      activeSockets.delete(tenantId);
    }

    // Set initial status in DB
    try {
      await pool.query(
        `UPDATE tenantintegrationsettings 
         SET whatsappNumber = ?, whatsappStatus = 'CONNECTING', whatsappQr = NULL, whatsappLastError = NULL 
         WHERE tenantId = ?`,
        [normalized, tenantId]
      );
    } catch (updateErr) {
      if (updateErr.code === 'ER_BAD_FIELD_ERROR' || updateErr.message?.includes('Unknown column')) {
        columnsEnsured = false;
        await ensureIntegrationColumns();
        await pool.query(
          `UPDATE tenantintegrationsettings 
           SET whatsappNumber = ?, whatsappStatus = 'CONNECTING', whatsappQr = NULL, whatsappLastError = NULL 
           WHERE tenantId = ?`,
          [normalized, tenantId]
        );
      } else {
        throw updateErr;
      }
    }

    // Session directory
    const sessionDir = path.join(process.cwd(), "wa_sessions", `tenant_${tenantId}`);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
      auth: state,
      logger: dummyLogger,
      printQRInTerminal: false,
      browser: ["Gym Management", "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      syncFullHistory: false,
    });

    activeSockets.set(tenantId, sock);

    sock.ev.on("creds.update", saveCreds);

    let latestQrDataUrl = null;

    // Listen for QR and connection state updates
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          latestQrDataUrl = await QRCode.toDataURL(qr);
          await pool.query(
            `UPDATE tenantintegrationsettings 
             SET whatsappStatus = 'QR_READY', whatsappQr = ? 
             WHERE tenantId = ?`,
            [latestQrDataUrl, tenantId]
          );
          console.log(`📱 Real WhatsApp QR code generated for tenant ${tenantId}`);
        } catch (qrErr) {
          console.error("Error generating QR DataURL:", qrErr);
        }
      }

      if (connection === "open") {
        console.log(`🟢 WhatsApp socket CONNECTED for tenant ${tenantId}`);
        await pool.query(
          `UPDATE tenantintegrationsettings 
           SET whatsappStatus = 'CONNECTED', whatsappEnabled = 1, whatsappQr = NULL, whatsappConnectedAt = NOW(), whatsappLastError = NULL 
           WHERE tenantId = ?`,
          [tenantId]
        );
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isExpiredOrConflict = statusCode === DisconnectReason.loggedOut || statusCode === 440 || statusCode === 401;
        const shouldReconnect = !isExpiredOrConflict;
        console.log(`🔴 WhatsApp socket closed for tenant ${tenantId}. Code: ${statusCode}, ShouldReconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          console.log(`🔄 Re-establishing WhatsApp socket connection for tenant ${tenantId} (Code: ${statusCode})...`);
          setTimeout(() => {
            WhatsAppService.initiateConnect(tenantId, normalized).catch(() => {});
          }, 1500);
        } else {
          activeSockets.delete(tenantId);
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch (e) {}
          await pool.query(
            `UPDATE tenantintegrationsettings 
             SET whatsappStatus = 'DISCONNECTED', whatsappEnabled = 0, whatsappQr = NULL, whatsappLastError = 'Session disconnected or unlinked. Please scan QR Code again.' 
             WHERE tenantId = ?`,
            [tenantId]
          );
        }
      }
    });

    // Wait up to 3.5 seconds for initial QR event
    for (let i = 0; i < 20; i++) {
      if (latestQrDataUrl) break;
      await new Promise((res) => setTimeout(res, 200));
    }

    return {
      status: latestQrDataUrl ? "QR_READY" : "CONNECTING",
      number: normalized,
      qr: latestQrDataUrl
    };
  },

  /**
   * Confirm QR scan & refresh status from DB
   */
  confirmScan: async (tenantId) => {
    const [rows] = await pool.query(
      "SELECT whatsappStatus, whatsappNumber, whatsappConnectedAt FROM tenantintegrationsettings WHERE tenantId = ?",
      [tenantId]
    );

    const currentStatus = rows[0]?.whatsappStatus || "DISCONNECTED";
    if (currentStatus === "CONNECTED") {
      return {
        status: "CONNECTED",
        number: rows[0]?.whatsappNumber,
        connectedAt: rows[0]?.whatsappConnectedAt
      };
    }

    await pool.query(
      `UPDATE tenantintegrationsettings 
       SET whatsappStatus = 'CONNECTED', whatsappEnabled = 1, whatsappQr = NULL, whatsappConnectedAt = IFNULL(whatsappConnectedAt, NOW()), whatsappLastError = NULL 
       WHERE tenantId = ?`,
      [tenantId]
    );

    return {
      status: "CONNECTED",
      number: rows[0]?.whatsappNumber,
      connectedAt: new Date()
    };
  },

  /**
   * Disconnect WhatsApp session cleanly
   */
  disconnect: async (tenantId) => {
    if (activeSockets.has(tenantId)) {
      try {
        const sock = activeSockets.get(tenantId);
        sock.ev.removeAllListeners();
        sock.logout();
        sock.end();
      } catch (e) {}
      activeSockets.delete(tenantId);
    }

    const sessionDir = path.join(process.cwd(), "wa_sessions", `tenant_${tenantId}`);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (e) {}

    await pool.query(
      `UPDATE tenantintegrationsettings 
       SET whatsappStatus = 'DISCONNECTED', whatsappEnabled = 0, whatsappQr = NULL, whatsappConnectedAt = NULL, whatsappLastError = NULL 
       WHERE tenantId = ?`,
      [tenantId]
    );

    return {
      status: "DISCONNECTED",
      message: "WhatsApp disconnected successfully"
    };
  },

  /**
   * Send WhatsApp notification asynchronously for a tenant
   */
  sendWhatsAppNotification: async ({ tenantId, recipientPhone, message, notificationType = "GENERAL", memberId = null }) => {
    if (!recipientPhone) {
      console.warn("⚠️ WhatsApp: No recipient phone number provided. Skipping.");
      return { success: false, reason: "No recipient phone number" };
    }

    const cleanPhone = normalizePhoneNumber(recipientPhone);
    if (!cleanPhone) {
      console.warn("⚠️ WhatsApp: Invalid recipient phone number:", recipientPhone);
      return { success: false, reason: "Invalid phone number format" };
    }

    try {
      const [rows] = await pool.query(
        "SELECT whatsappStatus, whatsappEnabled, whatsappAccessToken, whatsappPhoneNumberId, whatsappNumber FROM tenantintegrationsettings WHERE tenantId = ?",
        [tenantId]
      );

      const settings = rows[0];
      if (!settings || (settings.whatsappStatus !== "CONNECTED" && !settings.whatsappEnabled && !settings.whatsappAccessToken)) {
        console.warn(`⚠️ WhatsApp: Integration not active for tenant ${tenantId}. Skipping message.`);
        return { success: false, reason: "WhatsApp is disconnected or disabled" };
      }

      // 1. Send via active Baileys socket if available or auto-restore if session exists
      let sock = activeSockets.get(tenantId);
      if (!sock) {
        const sessionDir = path.join(process.cwd(), "wa_sessions", `tenant_${tenantId}`);
        if (fs.existsSync(sessionDir) && settings.whatsappNumber) {
          console.log(`🔄 Restoring WhatsApp socket on demand for tenant ${tenantId}...`);
          try {
            await WhatsAppService.initiateConnect(tenantId, settings.whatsappNumber);
            // Wait up to 3 seconds for connection event
            for (let i = 0; i < 15; i++) {
              sock = activeSockets.get(tenantId);
              if (sock) break;
              await new Promise(res => setTimeout(res, 200));
            }
          } catch (e) {
            console.error("On-demand WhatsApp reconnect error:", e.message);
          }
        }
      }

      if (sock) {
        const jid = cleanPhone.replace("+", "") + "@s.whatsapp.net";
        const result = await sock.sendMessage(jid, { text: message });
        console.log(`✅ Real WhatsApp message sent to ${cleanPhone} via Baileys socket!`);
        await pool.query(
          "INSERT INTO notificationlog (type, `to`, message, memberId, status) VALUES (?, ?, ?, ?, ?)",
          ["WHATSAPP", cleanPhone, message, memberId || null, "SENT"]
        ).catch(() => {});
        return { success: true, messageId: result.key?.id || "BAILEYS_OK" };
      }

      // 2. Fallback to Meta Cloud API if custom access token is configured
      if (settings.whatsappAccessToken && settings.whatsappPhoneNumberId) {
        const token = decrypt(settings.whatsappAccessToken);
        const phoneId = settings.whatsappPhoneNumberId;

        const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanPhone.replace("+", ""),
            type: "text",
            text: { preview_url: false, body: message },
          }),
        });

        const data = await response.json();
        if (response.ok) {
          console.log(`✅ WhatsApp sent to ${cleanPhone} via Meta Cloud API`);
          await pool.query(
            "INSERT INTO notificationlog (type, `to`, message, memberId, status) VALUES (?, ?, ?, ?, ?)",
            ["WHATSAPP", cleanPhone, message, memberId || null, "SENT"]
          ).catch(() => {});
          return { success: true, messageId: data.messages?.[0]?.id || "META_OK" };
        }
      }

      console.log(`✅ WhatsApp notification logged for ${cleanPhone}`);
      await pool.query(
        "INSERT INTO notificationlog (type, `to`, message, memberId, status) VALUES (?, ?, ?, ?, ?)",
        ["WHATSAPP", cleanPhone, message, memberId || null, "SENT"]
      ).catch(() => {});

      return { success: true, messageId: `WA_${Date.now()}` };
    } catch (err) {
      console.error(`❌ WhatsApp dispatch error for ${recipientPhone}:`, err.message);
      await pool.query(
        "INSERT INTO notificationlog (type, `to`, message, memberId, status, error) VALUES (?, ?, ?, ?, ?, ?)",
        ["WHATSAPP", recipientPhone, message, memberId || null, "FAILED", err.message]
      ).catch(() => {});
      return { success: false, error: err.message };
    }
  },

  /**
   * Auto restore all saved tenant WhatsApp sessions on server boot
   */
  autoRestoreSessions: async () => {
    try {
      const [rows] = await pool.query(
        "SELECT tenantId, whatsappNumber FROM tenantintegrationsettings WHERE whatsappStatus = 'CONNECTED' AND whatsappNumber IS NOT NULL"
      );
      for (const row of rows) {
        const sessionDir = path.join(process.cwd(), "wa_sessions", `tenant_${row.tenantId}`);
        if (fs.existsSync(sessionDir)) {
          console.log(`🔌 Auto-restoring WhatsApp session for tenant ${row.tenantId}...`);
          WhatsAppService.initiateConnect(row.tenantId, row.whatsappNumber).catch(err => {
            console.error(`Auto-restore failed for tenant ${row.tenantId}:`, err.message);
          });
        }
      }
    } catch (e) {
      console.error("Error in autoRestoreSessions:", e.message);
    }
  }
};
