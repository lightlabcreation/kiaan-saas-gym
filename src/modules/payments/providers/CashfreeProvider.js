import crypto from 'crypto';
import axios from 'axios';
import { BasePaymentProvider } from './PaymentProvider.interface.js';

export class CashfreeProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.appId = config.keyId || process.env.CASHFREE_APP_ID || process.env.CASHFREE_KEY_ID;
    this.secretKey = config.secretKey || process.env.CASHFREE_SECRET_KEY;
    this.webhookSecret = config.webhookSecret || process.env.CASHFREE_WEBHOOK_SECRET || this.secretKey;
    this.isTestMode = config.isTestMode !== undefined ? config.isTestMode : true;
    this.baseUrl = this.isTestMode ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-client-id': this.appId,
      'x-client-secret': this.secretKey,
      'x-api-version': '2023-08-01'
    };
  }

  async createOrder({ amount, currency = 'INR', transactionId, userDetails }) {
    if (!this.appId || !this.secretKey) {
      throw new Error("Cashfree API credentials (App ID and Secret Key) are not configured.");
    }

    const payload = {
      order_id: transactionId,
      order_amount: Number(amount),
      order_currency: currency.toUpperCase(),
      customer_details: {
        customer_id: String(userDetails?.id || `CUST_${Date.now()}`),
        customer_email: userDetails?.email || 'customer@gym.com',
        customer_phone: userDetails?.phone || '9999999999',
        customer_name: userDetails?.name || 'Gym Member'
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/my-subscription?order_id={order_id}`
      }
    };

    const response = await axios.post(`${this.baseUrl}/orders`, payload, {
      headers: this.getHeaders()
    });

    return {
      provider: 'CASHFREE',
      providerOrderId: response.data.order_id,
      paymentSessionId: response.data.payment_session_id,
      amount: Number(amount),
      currency: currency.toUpperCase(),
      transactionId
    };
  }

  async verifyPayment({ order_id, orderId }) {
    const targetOrderId = order_id || orderId;
    if (!targetOrderId) {
      return { success: false, message: "Order ID missing for Cashfree verification" };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/orders/${targetOrderId}`, {
        headers: this.getHeaders()
      });

      const isPaid = response.data.order_status === 'PAID';
      return {
        success: isPaid,
        providerOrderId: response.data.order_id,
        providerPaymentId: response.data.cf_order_id || targetOrderId,
        amount: response.data.order_amount,
        message: isPaid ? "Cashfree payment verified successfully" : `Payment status: ${response.data.order_status}`
      };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || err.message };
    }
  }

  async verifyWebhook(req) {
    const timestamp = req.headers['x-webhook-timestamp'];
    const signature = req.headers['x-webhook-signature'];
    
    if (!signature) {
      return { success: false, message: "Missing Cashfree webhook signature" };
    }

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const dataToSign = timestamp + rawBody;
    const expectedSignature = crypto.createHmac('sha256', this.secretKey).update(dataToSign).digest('base64');

    const isValid = expectedSignature === signature;
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    return {
      success: isValid,
      event: payload?.type,
      payload
    };
  }

  async processRefund({ providerPaymentId, amount, reason }) {
    const refundId = `REFUND_${Date.now()}`;
    const response = await axios.post(
      `${this.baseUrl}/orders/${providerPaymentId}/refunds`,
      { refund_amount: Number(amount), refund_id: refundId, refund_note: reason || 'Gym SaaS Refund' },
      { headers: this.getHeaders() }
    );

    return {
      success: response.data.refund_status === 'SUCCESS' || response.data.refund_status === 'PENDING',
      refundId: response.data.cf_refund_id || refundId,
      amount: response.data.refund_amount,
      status: response.data.refund_status
    };
  }
}
