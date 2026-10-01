import { pool } from "../../config/db.js";
import { PaymentService } from "./providers/PaymentService.js";

/**
 * Get Available Payment Methods & Configured Gateways
 */
export const getAvailableMethods = async (req, res) => {
  try {
    const tenantId = req.user?.id || req.query.tenantId || 1;

    // Fetch DB configs
    const [rows] = await pool.query(
      "SELECT provider, isEnabled, isTestMode FROM payment_gateway_config WHERE tenantId = ?",
      [tenantId]
    );

    const configMap = {};
    rows.forEach(r => {
      configMap[r.provider] = Boolean(r.isEnabled);
    });

    // Check environment fallbacks if not explicitly disabled
    const razorpayAvailable = configMap.RAZORPAY !== undefined ? configMap.RAZORPAY : Boolean(process.env.RAZORPAY_KEY_ID);
    const stripeAvailable = configMap.STRIPE !== undefined ? configMap.STRIPE : Boolean(process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_SECRET_KEY);
    const paypalAvailable = configMap.PAYPAL !== undefined ? configMap.PAYPAL : Boolean(process.env.PAYPAL_CLIENT_ID);
    const payuAvailable = configMap.PAYU !== undefined ? configMap.PAYU : Boolean(process.env.PAYU_MERCHANT_KEY);

    const availableProviders = [];
    if (razorpayAvailable) availableProviders.push('RAZORPAY');
    if (stripeAvailable) availableProviders.push('STRIPE');
    if (paypalAvailable) availableProviders.push('PAYPAL');
    if (payuAvailable) availableProviders.push('PAYU');

    // Default to at least RAZORPAY / STRIPE in development if none enabled
    if (availableProviders.length === 0) {
      availableProviders.push('RAZORPAY', 'STRIPE');
    }

    const availableMethods = [];
    if (stripeAvailable || razorpayAvailable || payuAvailable) {
      availableMethods.push('CREDIT_CARD', 'DEBIT_CARD');
    }
    if (stripeAvailable || razorpayAvailable) {
      availableMethods.push('GOOGLE_PAY', 'APPLE_PAY');
    }

    return res.status(200).json({
      success: true,
      data: {
        providers: availableProviders,
        methods: availableMethods,
        details: {
          razorpay: razorpayAvailable,
          stripe: stripeAvailable,
          paypal: paypalAvailable,
          payu: payuAvailable
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Initialize Payment Order
 */
export const createPaymentOrder = async (req, res) => {
  try {
    const { provider, paymentMethod, planId, amount, currency, planDetails, userDetails } = req.body;
    const userId = req.user?.id || userDetails?.id || 1;
    const tenantId = req.user?.id || 1;

    if (!provider || !amount) {
      return res.status(400).json({ success: false, message: "Provider and amount are required" });
    }

    const result = await PaymentService.createTransaction({
      tenantId,
      userId,
      planId,
      provider,
      paymentMethod,
      amount,
      currency: currency || 'INR',
      planDetails,
      userDetails
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error("Create payment order error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Submit Public Payment (No Auth Required)
 */
export const submitPublicPayment = async (req, res) => {
  try {
    const { amount, currency, name, email, phone, planName } = req.body;
    const result = await PaymentService.createTransaction({
      tenantId: 1,
      userId: 1,
      planId: 1,
      provider: 'RAZORPAY',
      paymentMethod: 'CREDIT_CARD',
      amount: amount || 999,
      currency: currency || 'INR',
      planDetails: { name: planName || 'Public Plan' },
      userDetails: { name: name || 'Public User', email, phone }
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Verify Server-Side Payment Callback
 */
export const verifyPayment = async (req, res) => {
  try {
    const { provider, payload } = req.body;
    const tenantId = req.user?.id || 1;

    if (!provider || !payload) {
      return res.status(400).json({ success: false, message: "Provider and payload are required" });
    }

    const result = await PaymentService.verifyAndCompletePayment({
      provider,
      payload,
      tenantId
    });

    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error("Payment verification error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Handle PayU Form Post Callback
 */
export const handlePayUCallback = async (req, res) => {
  try {
    const payload = req.method === 'POST' ? req.body : req.query;
    const result = await PaymentService.verifyAndCompletePayment({
      provider: 'PAYU',
      payload,
      tenantId: 1
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    if (result.success) {
      return res.redirect(`${frontendUrl}/admin/my-subscription?payment=success&txn=${result.transactionId}`);
    } else {
      return res.redirect(`${frontendUrl}/admin/my-subscription?payment=failed&reason=${encodeURIComponent(result.message)}`);
    }
  } catch (err) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/admin/my-subscription?payment=failed&reason=${encodeURIComponent(err.message)}`);
  }
};

/**
 * Handle Provider Webhooks
 */
export const handleWebhook = async (req, res) => {
  try {
    const { provider } = req.params;
    const result = await PaymentService.processWebhook(provider, req);

    if (result.success) {
      return res.status(200).json({ status: "ok", received: true });
    } else {
      return res.status(400).json({ status: "error", message: result.message });
    }
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    return res.status(500).json({ status: "error", message: err.message });
  }
};

/**
 * Fetch Payment Transactions (History & Admin Dashboard)
 */
export const getTransactions = async (req, res) => {
  try {
    const { search, status, provider, method, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = "SELECT * FROM payment_transaction WHERE 1=1";
    const params = [];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (provider) {
      query += " AND provider = ?";
      params.push(provider.toUpperCase());
    }
    if (method) {
      query += " AND paymentMethod = ?";
      params.push(method.toUpperCase());
    }
    if (search) {
      query += " AND (transactionId LIKE ? OR providerOrderId LIKE ? OR providerPaymentId LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [rows] = await pool.query(query, params);

    // Get total count
    const [countRows] = await pool.query("SELECT COUNT(*) as total FROM payment_transaction");
    const total = countRows[0]?.total || 0;

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Admin Gateway Settings Getter (Masked)
 */
export const getAdminGateways = async (req, res) => {
  try {
    const tenantId = req.user?.id || 1;
    const [rows] = await pool.query(
      "SELECT provider, isEnabled, isTestMode, keyId, webhookSecret, merchantSalt, updatedAt FROM payment_gateway_config WHERE tenantId = ?",
      [tenantId]
    );

    const gateways = {
      RAZORPAY: { isEnabled: false, isTestMode: true, keyId: "", webhookSecret: "", configured: false },
      STRIPE: { isEnabled: false, isTestMode: true, keyId: "", webhookSecret: "", configured: false },
      PAYPAL: { isEnabled: false, isTestMode: true, keyId: "", webhookSecret: "", configured: false },
      PAYU: { isEnabled: false, isTestMode: true, keyId: "", merchantSalt: "", configured: false }
    };

    rows.forEach(r => {
      if (gateways[r.provider]) {
        gateways[r.provider] = {
          isEnabled: Boolean(r.isEnabled),
          isTestMode: Boolean(r.isTestMode),
          keyId: r.keyId || "",
          webhookSecret: r.webhookSecret ? "************" : "",
          merchantSalt: r.merchantSalt ? "************" : "",
          configured: Boolean(r.keyId)
        };
      }
    });

    return res.status(200).json({
      success: true,
      data: gateways
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Admin Gateway Settings Update
 */
export const updateAdminGateway = async (req, res) => {
  try {
    const tenantId = req.user?.id || 1;
    const { provider, isEnabled, isTestMode, keyId, secretKey, webhookSecret, merchantSalt } = req.body;

    if (!provider) {
      return res.status(400).json({ success: false, message: "Provider is required" });
    }

    const p = provider.toUpperCase();

    // Check if configuration exists
    const [existing] = await pool.query(
      "SELECT id FROM payment_gateway_config WHERE tenantId = ? AND provider = ?",
      [tenantId, p]
    );

    if (existing.length > 0) {
      let query = "UPDATE payment_gateway_config SET isEnabled = ?, isTestMode = ?";
      const params = [Boolean(isEnabled), Boolean(isTestMode)];

      if (keyId) {
        query += ", keyId = ?";
        params.push(keyId);
      }
      if (secretKey && secretKey !== "************") {
        query += ", secretKey = ?";
        params.push(secretKey);
      }
      if (webhookSecret && webhookSecret !== "************") {
        query += ", webhookSecret = ?";
        params.push(webhookSecret);
      }
      if (merchantSalt && merchantSalt !== "************") {
        query += ", merchantSalt = ?";
        params.push(merchantSalt);
      }

      query += " WHERE tenantId = ? AND provider = ?";
      params.push(tenantId, p);

      await pool.query(query, params);
    } else {
      await pool.query(
        `INSERT INTO payment_gateway_config 
         (tenantId, provider, isEnabled, isTestMode, keyId, secretKey, webhookSecret, merchantSalt) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          p,
          Boolean(isEnabled),
          Boolean(isTestMode),
          keyId || '',
          secretKey !== "************" ? secretKey : '',
          webhookSecret !== "************" ? webhookSecret : '',
          merchantSalt !== "************" ? merchantSalt : ''
        ]
      );
    }

    return res.status(200).json({
      success: true,
      message: `${p} gateway settings updated successfully`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Refund Payment
 */
export const refundPayment = async (req, res) => {
  try {
    const { transactionId, amount, reason } = req.body;
    if (!transactionId) {
      return res.status(400).json({ success: false, message: "Transaction ID is required" });
    }

    const result = await PaymentService.processRefund({ transactionId, amount, reason });
    return res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
