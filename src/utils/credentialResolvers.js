import { pool } from "../config/db.js";
import { decrypt } from "./encryption.js";

/**
 * Resolves credentials for Payment Gateway
 */
export const PaymentCredentialResolver = {
  getSuperAdminRazorpayCredentials: () => {
    return {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
    };
  },

  getTenantRazorpayCredentials: async (tenantId) => {
    if (!tenantId) return null;
    
    const [rows] = await pool.query(
      "SELECT razorpayKeyId, razorpaySecret, paymentGatewayEnabled FROM tenantintegrationsettings WHERE tenantId = ?",
      [tenantId]
    );

    if (rows.length === 0 || !rows[0].paymentGatewayEnabled || !rows[0].razorpayKeyId || !rows[0].razorpaySecret) {
      return null;
    }

    const decryptedSecret = decrypt(rows[0].razorpaySecret);
    if (!decryptedSecret) return null;

    return {
      keyId: rows[0].razorpayKeyId,
      keySecret: decryptedSecret,
    };
  },
};

/**
 * Resolves credentials for Brevo Email Dispatcher
 */
export const BrevoCredentialResolver = {
  getSuperAdminBrevoCredentials: () => {
    return {
      apiKey: process.env.BREVO_API_KEY,
      senderEmail: process.env.MAIL_FROM_EMAIL || process.env.MAIL_FROM || "info@kiaantechnology.com",
      senderName: process.env.MAIL_FROM_NAME || "Kiaan Technology Pvt Ltd",
    };
  },

  getTenantBrevoCredentials: async (tenantId) => {
    if (!tenantId) return null;

    const [rows] = await pool.query(
      "SELECT brevoApiKey, brevoSenderEmail, brevoSenderName, emailEnabled FROM tenantintegrationsettings WHERE tenantId = ?",
      [tenantId]
    );

    if (rows.length === 0 || !rows[0].emailEnabled || !rows[0].brevoApiKey || !rows[0].brevoSenderEmail) {
      return null;
    }

    const decryptedApiKey = decrypt(rows[0].brevoApiKey);
    if (!decryptedApiKey) return null;

    return {
      apiKey: decryptedApiKey,
      senderEmail: rows[0].brevoSenderEmail,
      senderName: rows[0].brevoSenderName || "GymSoft User",
    };
  },
};

/**
 * Resolves credentials for WhatsApp Cloud API
 */
export const WhatsAppCredentialResolver = {
  getTenantWhatsAppCredentials: async (tenantId) => {
    if (!tenantId) return null;

    const [rows] = await pool.query(
      "SELECT whatsappAccessToken, whatsappPhoneNumberId, whatsappEnabled FROM tenantintegrationsettings WHERE tenantId = ?",
      [tenantId]
    );

    if (rows.length === 0 || !rows[0].whatsappEnabled || !rows[0].whatsappAccessToken || !rows[0].whatsappPhoneNumberId) {
      return null;
    }

    const decryptedToken = decrypt(rows[0].whatsappAccessToken);
    if (!decryptedToken) return null;

    return {
      accessToken: decryptedToken,
      phoneNumberId: rows[0].whatsappPhoneNumberId,
    };
  },
};

/**
 * Resolves credentials for SMTP Email Dispatcher
 */
export const SmtpCredentialResolver = {
  getTenantSmtpCredentials: async (tenantId) => {
    if (!tenantId) return null;

    const [rows] = await pool.query(
      "SELECT smtpHost, smtpPort, smtpUsername, smtpPassword, smtpEncryption, smtpEnabled, smtpProvider, brevoSenderEmail, brevoSenderName FROM tenantintegrationsettings WHERE tenantId = ?",
      [tenantId]
    );

    if (rows.length === 0 || !rows[0].smtpEnabled || !rows[0].smtpHost || !rows[0].smtpUsername || !rows[0].smtpPassword) {
      return null;
    }

    const decryptedPassword = decrypt(rows[0].smtpPassword);
    if (!decryptedPassword) return null;

    const port = Number(rows[0].smtpPort) || 587;
    const isSecure = port === 465 || rows[0].smtpEncryption === 'SSL/TLS';

    return {
      provider: rows[0].smtpProvider || 'gmail',
      host: rows[0].smtpHost || "smtp.gmail.com",
      port: port,
      secure: isSecure,
      encryption: rows[0].smtpEncryption || (port === 465 ? 'SSL/TLS' : 'STARTTLS'),
      auth: {
        user: rows[0].smtpUsername,
        pass: decryptedPassword
      },
      senderEmail: rows[0].brevoSenderEmail || rows[0].smtpUsername,
      senderName: rows[0].brevoSenderName || "Gym Owner",
      smtpEnabled: Boolean(rows[0].smtpEnabled)
    };
  }
};

