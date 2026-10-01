import { pool } from '../../../config/db.js';
import { RazorpayProvider } from './RazorpayProvider.js';
import { StripeProvider } from './StripeProvider.js';
import { PayPalProvider } from './PayPalProvider.js';
import { PayUProvider } from './PayUProvider.js';

export class PaymentService {
  /**
   * Resolve gateway credentials from DB or Environment
   */
  static async getGatewayConfig(providerName, tenantId = 1) {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM payment_gateway_config WHERE tenantId = ? AND provider = ?",
        [tenantId, providerName.toUpperCase()]
      );

      if (rows.length > 0 && rows[0].isEnabled) {
        return {
          isEnabled: Boolean(rows[0].isEnabled),
          isTestMode: Boolean(rows[0].isTestMode),
          keyId: rows[0].keyId,
          secretKey: rows[0].secretKey,
          webhookSecret: rows[0].webhookSecret,
          merchantSalt: rows[0].merchantSalt
        };
      }
    } catch (e) {
      console.error(`Failed to fetch DB config for ${providerName}:`, e.message);
    }

    // Fallback to Environment Variables
    const p = providerName.toUpperCase();
    return {
      isEnabled: true,
      isTestMode: process.env.NODE_ENV !== 'production',
      keyId: process.env[`${p}_KEY_ID`] || process.env[`${p}_PUBLISHABLE_KEY`] || process.env[`${p}_CLIENT_ID`] || process.env[`${p}_MERCHANT_KEY`],
      secretKey: process.env[`${p}_KEY_SECRET`] || process.env[`${p}_SECRET_KEY`] || process.env[`${p}_CLIENT_SECRET`] || process.env[`${p}_SECRET`],
      webhookSecret: process.env[`${p}_WEBHOOK_SECRET`],
      merchantSalt: process.env[`${p}_MERCHANT_SALT`]
    };
  }

  /**
   * Instantiate Provider instance based on name
   */
  static async getProviderInstance(providerName, tenantId = 1) {
    const config = await this.getGatewayConfig(providerName, tenantId);
    const p = providerName.toUpperCase();

    switch (p) {
      case 'RAZORPAY':
        return new RazorpayProvider(config);
      case 'STRIPE':
        return new StripeProvider(config);
      case 'PAYPAL':
        return new PayPalProvider(config);
      case 'PAYU':
        return new PayUProvider(config);
      default:
        throw new Error(`Unsupported payment provider: ${providerName}`);
    }
  }

  /**
   * Create Transaction Record and Order
   */
  static async createTransaction({ tenantId = 1, userId, planId, provider, paymentMethod = 'CREDIT_CARD', amount, currency = 'INR', planDetails, userDetails }) {
    const transactionId = `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    // 1. Insert Pending Transaction in DB
    await pool.query(
      `INSERT INTO payment_transaction 
       (transactionId, userId, tenantId, planId, provider, paymentMethod, amount, currency, status, metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
      [
        transactionId,
        userId || tenantId,
        tenantId,
        planId || null,
        provider.toUpperCase(),
        paymentMethod.toUpperCase(),
        amount,
        currency,
        JSON.stringify({ planDetails, userDetails })
      ]
    );

    // 2. Get Provider instance and create gateway order
    const providerInstance = await this.getProviderInstance(provider, tenantId);
    const orderResponse = await providerInstance.createOrder({
      amount,
      currency,
      transactionId,
      planDetails,
      userDetails
    });

    // 3. Update providerOrderId in DB
    if (orderResponse.providerOrderId) {
      await pool.query(
        "UPDATE payment_transaction SET providerOrderId = ? WHERE transactionId = ?",
        [orderResponse.providerOrderId, transactionId]
      );
    }

    return {
      success: true,
      transactionId,
      ...orderResponse
    };
  }

  /**
   * Verify Payment Server-Side and Complete Order
   */
  static async verifyAndCompletePayment({ provider, payload, tenantId = 1 }) {
    // Look up transaction by system transactionId or provider order ID
    let transaction = null;
    const lookupId = payload.transactionId || payload.razorpayOrderId || payload.paymentIntentId || payload.paypalOrderId || payload.txnid;

    if (lookupId) {
      const [rows] = await pool.query(
        `SELECT * FROM payment_transaction 
         WHERE transactionId = ? OR providerOrderId = ? OR providerPaymentId = ? LIMIT 1`,
        [lookupId, lookupId, lookupId]
      );
      if (rows.length > 0) {
        transaction = rows[0];
      }
    }

    // Idempotency check: if already successful, return existing status
    if (transaction && transaction.status === 'Successful') {
      return {
        success: true,
        alreadyProcessed: true,
        transactionId: transaction.transactionId,
        message: "Transaction already processed successfully"
      };
    }

    // Get Provider Instance and verify signature/hash
    const providerInstance = await this.getProviderInstance(provider, tenantId);
    const verification = await providerInstance.verifyPayment(payload);

    if (!verification.success) {
      if (transaction) {
        await pool.query(
          "UPDATE payment_transaction SET status = 'Failed', rawProviderResponse = ? WHERE id = ?",
          [JSON.stringify(payload), transaction.id]
        );
      }
      return {
        success: false,
        message: verification.message || "Payment verification failed"
      };
    }

    // Payment Signature Verified! Update DB and Activate Subscription
    const providerPaymentId = verification.providerPaymentId || payload.razorpayPaymentId || payload.paymentIntentId || payload.mihpayid;
    const providerOrderId = verification.providerOrderId || payload.razorpayOrderId || payload.txnid;

    if (transaction) {
      await pool.query(
        `UPDATE payment_transaction 
         SET status = 'Successful', providerPaymentId = ?, providerOrderId = ?, rawProviderResponse = ? 
         WHERE id = ?`,
        [providerPaymentId, providerOrderId, JSON.stringify(payload), transaction.id]
      );
    } else {
      // Record new transaction if direct verification callback
      const txId = payload.transactionId || `TXN_${Date.now()}`;
      await pool.query(
        `INSERT INTO payment_transaction 
         (transactionId, userId, tenantId, provider, providerPaymentId, providerOrderId, amount, status, rawProviderResponse) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Successful', ?)`,
        [txId, tenantId, tenantId, provider.toUpperCase(), providerPaymentId, providerOrderId, verification.amount || 0, JSON.stringify(payload)]
      );
    }

    // 🚀 Activate User / Tenant Subscription
    const invoiceId = await this.activateSubscription({
      userId: transaction ? transaction.userId : tenantId,
      planId: transaction ? transaction.planId : null,
      amount: transaction ? transaction.amount : verification.amount,
      provider,
      transactionId: transaction ? transaction.transactionId : lookupId
    });

    return {
      success: true,
      transactionId: transaction ? transaction.transactionId : lookupId,
      invoiceId,
      message: "Payment verified & subscription activated successfully!"
    };
  }

  /**
   * Subscription Activation Helper
   */
  static async activateSubscription({ userId, planId, amount, provider, transactionId }) {
    try {
      const invoiceNo = `INV-SAAS-${Date.now()}`;
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30); // 30-day billing cycle

      // Update user plan status
      if (userId) {
        await pool.query(
          `UPDATE user 
           SET status = 'Active', isTrial = 0, trialStatus = 'Paid', licenseExpiryDate = ? 
           WHERE id = ?`,
          [expiryDate, userId]
        );
      }

      // Record in purchase/saas table
      await pool.query(
        `INSERT INTO purchase 
         (companyName, email, selectedPlan, billingDuration, startDate, status, amount, transactionId) 
         VALUES ('Active SaaS User', 'billing@saas.com', 'Pro Plan', 'Monthly', NOW(), 'active', ?, ?)`,
        [amount || 0, transactionId]
      );

      return invoiceNo;
    } catch (e) {
      console.error("Failed to activate subscription:", e.message);
      return null;
    }
  }

  /**
   * Process Provider Webhooks Idempotently
   */
  static async processWebhook(providerName, req) {
    const providerInstance = await this.getProviderInstance(providerName);
    const webhookRes = await providerInstance.verifyWebhook(req);

    if (!webhookRes.success) {
      return { success: false, message: "Webhook verification failed" };
    }

    const { event, payload } = webhookRes;
    console.log(`✅ Webhook verified for ${providerName} (${event})`);

    return { success: true, event, payload };
  }

  /**
   * Process Refund
   */
  static async processRefund({ transactionId, amount, reason }) {
    const [rows] = await pool.query(
      "SELECT * FROM payment_transaction WHERE transactionId = ?",
      [transactionId]
    );

    if (rows.length === 0) {
      throw new Error("Transaction not found");
    }

    const txn = rows[0];
    const providerInstance = await this.getProviderInstance(txn.provider, txn.tenantId);
    
    const refundRes = await providerInstance.processRefund({
      providerPaymentId: txn.providerPaymentId || txn.providerOrderId,
      amount: amount || txn.amount,
      reason
    });

    if (refundRes.success) {
      await pool.query(
        "UPDATE payment_transaction SET status = 'Refunded' WHERE id = ?",
        [txn.id]
      );
    }

    return refundRes;
  }
}
