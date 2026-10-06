import { pool } from "../../config/db.js";
import { encrypt } from "../../utils/encryption.js";
import { BrevoCredentialResolver, PaymentCredentialResolver, WhatsAppCredentialResolver, SmtpCredentialResolver } from "../../utils/credentialResolvers.js";
import { uploadToCloudinary } from "../../config/cloudinary.js";
import { ensureIntegrationColumns } from "./whatsapp.service.js";

// Fetch integration statuses (Masked credentials)
export const getIntegrations = async (req, res) => {
  try {
    const tenantId = req.user.id;
    await ensureIntegrationColumns();
    
    // Auto-create setting row if doesn't exist
    await pool.query("INSERT IGNORE INTO tenantintegrationsettings (tenantId) VALUES (?)", [tenantId]);

    const [rows] = await pool.query("SELECT * FROM tenantintegrationsettings WHERE tenantId = ?", [tenantId]);
    const settings = rows[0] || {};

    return res.status(200).json({
      success: true,
      data: {
        paymentGatewayEnabled: Boolean(settings.paymentGatewayEnabled),
        emailEnabled: Boolean(settings.emailEnabled),
        whatsappEnabled: Boolean(settings.whatsappEnabled),
        smtpEnabled: Boolean(settings.smtpEnabled),
        isVerified: settings.isVerified,
        lastVerifiedAt: settings.lastVerifiedAt,
        lastTestStatus: settings.lastTestStatus,
        lastTestMessage: settings.lastTestMessage,
        // Send masked strings or null
        razorpayKeyId: settings.razorpayKeyId ? "************" : null,
        razorpaySecret: settings.razorpaySecret ? "************" : null,
        brevoApiKey: settings.brevoApiKey ? "************" : null,
        brevoSenderEmail: settings.brevoSenderEmail || null,
        brevoSenderName: settings.brevoSenderName || null,
        upiQrCode: settings.upiQrCode || null,
        upiId: settings.upiId || null,
        upiAccountHolder: settings.upiAccountHolder || null,
        paymentInstructions: settings.paymentInstructions || null,
        // SMTP Fields
        smtpProvider: settings.smtpProvider || (
          (settings.smtpHost || "").toLowerCase().includes("resend") ? "resend" :
          (settings.smtpHost || "").toLowerCase().includes("brevo") ? "brevo" : "gmail"
        ),
        smtpHost: settings.smtpHost || "smtp.gmail.com",
        smtpPort: settings.smtpPort || 587,
        smtpUsername: settings.smtpUsername || null,
        smtpPassword: settings.smtpPassword ? "************" : null,
        smtpEncryption: settings.smtpEncryption || (settings.smtpPort === 465 ? "SSL/TLS" : "STARTTLS"),
        // WhatsApp Fields
        whatsappNumber: settings.whatsappNumber || null,
        whatsappStatus: settings.whatsappStatus || "DISCONNECTED",
        whatsappQr: settings.whatsappQr || null,
        whatsappConnectedAt: settings.whatsappConnectedAt || null,
        whatsappLastError: settings.whatsappLastError || null,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update Razorpay Settings
export const updateRazorpay = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { razorpayKeyId, razorpaySecret, paymentGatewayEnabled } = req.body;
    
    let query = "UPDATE tenantintegrationsettings SET paymentGatewayEnabled = ?";
    const params = [paymentGatewayEnabled];

    if (razorpayKeyId && razorpayKeyId !== "************") {
      query += ", razorpayKeyId = ?";
      params.push(razorpayKeyId);
    }
    
    if (razorpaySecret && razorpaySecret !== "************") {
      query += ", razorpaySecret = ?";
      params.push(encrypt(razorpaySecret));
    }
    
    query += " WHERE tenantId = ?";
    params.push(tenantId);
    
    await pool.query(query, params);
    res.status(200).json({ success: true, message: "Razorpay settings updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update Brevo Settings
export const updateBrevo = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { brevoApiKey, brevoSenderEmail, brevoSenderName, emailEnabled } = req.body;
    
    let query = "UPDATE tenantintegrationsettings SET emailEnabled = ?, brevoSenderEmail = ?, brevoSenderName = ?";
    const params = [emailEnabled, brevoSenderEmail, brevoSenderName];

    if (brevoApiKey && brevoApiKey !== "************") {
      query += ", brevoApiKey = ?";
      params.push(encrypt(brevoApiKey));
    }
    
    query += " WHERE tenantId = ?";
    params.push(tenantId);
    
    await pool.query(query, params);
    res.status(200).json({ success: true, message: "Brevo settings updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update SMTP Settings
export const updateSmtp = async (req, res) => {
  try {
    const tenantId = req.user.id;
    await ensureIntegrationColumns();
    await pool.query("INSERT IGNORE INTO tenantintegrationsettings (tenantId) VALUES (?)", [tenantId]);
    const { smtpHost, smtpPort, smtpUsername, smtpPassword, smtpEncryption, smtpEnabled, smtpProvider, senderEmail, senderName, action } = req.body;

    if (action === "remove") {
      await pool.query(
        `UPDATE tenantintegrationsettings 
         SET smtpHost = 'smtp.gmail.com', smtpPort = 587, smtpUsername = NULL, smtpPassword = NULL, smtpEncryption = 'STARTTLS', smtpEnabled = 0, smtpProvider = 'gmail' 
         WHERE tenantId = ?`,
        [tenantId]
      );
      return res.status(200).json({ success: true, message: "SMTP configuration removed successfully" });
    }

    const host = (smtpHost || "smtp.gmail.com").trim();
    const port = parseInt(smtpPort) || 587;
    const username = (smtpUsername || "").trim();
    const encryption = (smtpEncryption || (port === 465 ? "SSL/TLS" : "STARTTLS")).trim();
    const enabled = smtpEnabled ? 1 : 0;
    const provider = (smtpProvider || "gmail").trim();

    let query = "UPDATE tenantintegrationsettings SET smtpHost = ?, smtpPort = ?, smtpUsername = ?, smtpEncryption = ?, smtpEnabled = ?, smtpProvider = ?";
    const params = [host, port, username, encryption, enabled, provider];

    if (senderEmail !== undefined) {
      query += ", brevoSenderEmail = ?";
      params.push(senderEmail);
    }
    if (senderName !== undefined) {
      query += ", brevoSenderName = ?";
      params.push(senderName);
    }

    if (smtpPassword && smtpPassword !== "************" && !smtpPassword.startsWith("•")) {
      query += ", smtpPassword = ?";
      params.push(encrypt(smtpPassword));
    }

    query += " WHERE tenantId = ?";
    params.push(tenantId);

    await pool.query(query, params);
    res.status(200).json({ success: true, message: "SMTP settings updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update Admin UPI Settings
export const updateAdminUPI = async (req, res) => {
  try {
    const tenantId = req.user.id;
    await ensureIntegrationColumns();
    await pool.query("INSERT IGNORE INTO tenantintegrationsettings (tenantId) VALUES (?)", [tenantId]);
    let { upiId, upiAccountHolder, paymentInstructions } = req.body;
    let upiQrCode = null;

    // First fetch existing to keep the QR code if no new file is uploaded
    const [rows] = await pool.query("SELECT upiQrCode FROM tenantintegrationsettings WHERE tenantId = ?", [tenantId]);
    if (rows.length > 0) {
      upiQrCode = rows[0].upiQrCode;
    }

    if (req.files && req.files.upiQrCodeFile) {
      upiQrCode = await uploadToCloudinary(req.files.upiQrCodeFile, "gym/upi-qr");
    } else if (req.body.deleteQrCode === 'true') {
      upiQrCode = null;
    }

    let query = "UPDATE tenantintegrationsettings SET upiQrCode = ? WHERE tenantId = ?";
    const params = [upiQrCode, tenantId];
    
    await pool.query(query, params);
    res.status(200).json({ success: true, message: "UPI Payment settings updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const testRazorpay = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const creds = await PaymentCredentialResolver.getTenantRazorpayCredentials(tenantId);
    if (!creds) {
       return res.status(400).json({ success: false, message: "Razorpay not configured properly" });
    }
    
    await pool.query("UPDATE tenantintegrationsettings SET isVerified = 1, lastVerifiedAt = NOW(), lastTestStatus = 'SUCCESS', lastTestMessage = NULL WHERE tenantId = ?", [tenantId]);
    res.status(200).json({ success: true, message: "Razorpay Connection Successful" });
  } catch (err) {
    await pool.query("UPDATE tenantintegrationsettings SET isVerified = 0, lastTestStatus = 'FAILED', lastTestMessage = ? WHERE tenantId = ?", [err.message, tenantId]);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const testBrevo = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const creds = await BrevoCredentialResolver.getTenantBrevoCredentials(tenantId);
    if (!creds) {
       return res.status(400).json({ success: false, message: "Brevo not configured properly" });
    }
    
    const response = await fetch("https://api.brevo.com/v3/account", {
      headers: { "api-key": creds.apiKey }
    });
    
    if (!response.ok) {
       throw new Error("Invalid API Key");
    }
    
    await pool.query("UPDATE tenantintegrationsettings SET isVerified = 1, lastVerifiedAt = NOW(), lastTestStatus = 'SUCCESS', lastTestMessage = NULL WHERE tenantId = ?", [tenantId]);
    res.status(200).json({ success: true, message: "Brevo Connection Successful" });
  } catch (err) {
    await pool.query("UPDATE tenantintegrationsettings SET isVerified = 0, lastTestStatus = 'FAILED', lastTestMessage = ? WHERE tenantId = ?", [err.message, tenantId]);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const testSmtp = async (req, res) => {
  try {
    const tenantId = req.user.id;
    let creds = await SmtpCredentialResolver.getTenantSmtpCredentials(tenantId);
    
    // Fallback or override if unmasked credentials passed in test request
    if (!creds || (req.body.smtpPassword && !req.body.smtpPassword.startsWith("•") && req.body.smtpPassword !== "************")) {
      const host = req.body.smtpHost || creds?.host || "smtp.gmail.com";
      const port = parseInt(req.body.smtpPort) || creds?.port || 587;
      const user = req.body.smtpUsername || creds?.auth?.user;
      const pass = (req.body.smtpPassword && !req.body.smtpPassword.startsWith("•") && req.body.smtpPassword !== "************") 
        ? req.body.smtpPassword 
        : creds?.auth?.pass;
      const senderEmail = req.body.senderEmail || req.body.brevoSenderEmail || creds?.senderEmail || user;
      const senderName = req.body.senderName || req.body.brevoSenderName || creds?.senderName || "Gym Management Admin";

      if (user && pass) {
        creds = {
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
          senderEmail,
          senderName
        };
      }
    }

    if (!creds || !creds.auth?.user || !creds.auth?.pass) {
      return res.status(400).json({ success: false, message: "SMTP credentials not configured or missing username/password." });
    }

    const nodemailer = (await import("nodemailer")).default;
    const transporter = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: creds.auth,
      tls: {
        rejectUnauthorized: false
      }
    });

    // 1. Verify connection
    await transporter.verify();

    // 2. Send real test email to configured senderEmail or SMTP username
    const recipientEmail = creds.senderEmail || creds.auth.user;
    const senderName = creds.senderName || "Gym Management Admin";

    await transporter.sendMail({
      from: `"${senderName}" <${creds.senderEmail || creds.auth.user}>`,
      to: recipientEmail,
      subject: "Test Email from Gym Management Software",
      text: `Hello,\n\nThis is a real test email sent from your Gym Management Software to verify that your SMTP email delivery settings are properly configured and working.\n\nSender Email: ${recipientEmail}\nSMTP Host: ${creds.host}:${creds.port}\n\nIf you received this message, your SMTP configuration is active and working correctly.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #ffffff;">
          <div style="background-color: #4f46e5; padding: 16px 20px; border-radius: 6px 6px 0 0; text-align: center;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px;">Gym Management Software</h2>
            <p style="color: #c7d2fe; margin: 4px 0 0 0; font-size: 14px;">SMTP Connection Verification</p>
          </div>
          <div style="padding: 24px 20px;">
            <h3 style="color: #1f2937; margin-top: 0;">✅ SMTP Test Email Successful!</h3>
            <p style="color: #4b5563; line-height: 1.6;">
              This is an official test email sent from your Gym Management Software to confirm that your custom SMTP settings have been successfully verified and connected.
            </p>
            <div style="background-color: #f3f4f6; border-left: 4px solid #4f46e5; padding: 12px 16px; margin: 20px 0; border-radius: 0 4px 4px 0;">
              <p style="margin: 4px 0; font-size: 13px; color: #374151;"><strong>Sender Email:</strong> ${recipientEmail}</p>
              <p style="margin: 4px 0; font-size: 13px; color: #374151;"><strong>Sender Name:</strong> ${senderName}</p>
              <p style="margin: 4px 0; font-size: 13px; color: #374151;"><strong>SMTP Server:</strong> ${creds.host}:${creds.port}</p>
              <p style="margin: 4px 0; font-size: 13px; color: #374151;"><strong>Delivery Status:</strong> Active</p>
            </div>
            <p style="color: #6b7280; font-size: 13px;">
              You can now seamlessly send welcome emails, payment receipts, attendance notifications, membership reminders, and announcements directly to your members using your official gym email address.
            </p>
          </div>
          <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; text-align: center; color: #9ca3af; font-size: 12px;">
            <p style="margin: 0;">Gym Management Software — Automated SMTP Test Message</p>
          </div>
        </div>
      `
    });

    await pool.query("UPDATE tenantintegrationsettings SET isVerified = 1, lastVerifiedAt = NOW(), lastTestStatus = 'SUCCESS', lastTestMessage = NULL WHERE tenantId = ?", [tenantId]);
    res.status(200).json({ 
      success: true, 
      message: `SMTP Connection Verified! Test email sent successfully to ${recipientEmail}` 
    });
  } catch (err) {
    await pool.query("UPDATE tenantintegrationsettings SET isVerified = 0, lastTestStatus = 'FAILED', lastTestMessage = ? WHERE tenantId = ?", [err.message, tenantId]);
    
    let safeMsg = err.message || "Unknown connection error";
    if (safeMsg.includes("invalid login") || safeMsg.includes("Authentication failed") || safeMsg.includes("535")) {
      safeMsg = "Authentication failed. Please check your SMTP Username and Password / App Key.";
    } else if (safeMsg.includes("ETIMEDOUT") || safeMsg.includes("ENOTFOUND")) {
      safeMsg = "Could not connect to SMTP server host. Please verify Host name and Port.";
    }

    res.status(400).json({ success: false, message: "SMTP Test Failed: " + safeMsg });
  }
};

// ── WHATSAPP CONNECTIVITY CONTROLLERS ──
import { WhatsAppService } from "./whatsapp.service.js";

export const getWhatsAppStatus = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const data = await WhatsAppService.getStatus(tenantId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const connectWhatsApp = async (req, res) => {
  try {
    const tenantId = req.user.id;
    let { number, phoneNumber, phone, mobile } = req.body || {};
    let targetNumber = (number || phoneNumber || phone || mobile || "").trim();

    // If not provided in body, fallback to saved number in tenantintegrationsettings or users table
    if (!targetNumber) {
      const [rows] = await pool.query(
        "SELECT whatsappNumber FROM tenantintegrationsettings WHERE tenantId = ?",
        [tenantId]
      );
      if (rows.length > 0 && rows[0].whatsappNumber) {
        targetNumber = rows[0].whatsappNumber;
      } else {
        const [userRows] = await pool.query(
          "SELECT phone FROM users WHERE id = ?",
          [tenantId]
        );
        if (userRows.length > 0 && userRows[0].phone) {
          targetNumber = userRows[0].phone;
        }
      }
    }

    if (!targetNumber) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp phone number is required. Please provide a valid mobile number with country code (e.g., +919876543210)."
      });
    }

    const data = await WhatsAppService.initiateConnect(tenantId, targetNumber);
    return res.status(200).json({
      success: true,
      message: "WhatsApp connection initiated. Scan QR code.",
      data
    });
  } catch (err) {
    console.error("WhatsApp connect error:", err);
    res.status(400).json({ success: false, message: err.message || "Failed to initiate WhatsApp connection" });
  }
};

export const confirmWhatsAppScan = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const data = await WhatsAppService.confirmScan(tenantId);
    return res.status(200).json({ success: true, message: "WhatsApp connected successfully!", data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const disconnectWhatsApp = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const data = await WhatsAppService.disconnect(tenantId);
    return res.status(200).json({ success: true, message: "WhatsApp disconnected successfully", data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};




