import crypto from 'crypto';
import axios from 'axios';
import { BasePaymentProvider } from './PaymentProvider.interface.js';

export class RazorpayProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.keyId = config.keyId || process.env.RAZORPAY_KEY_ID;
    this.keySecret = config.secretKey || process.env.RAZORPAY_KEY_SECRET;
    this.webhookSecret = config.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || 'razorpay_wh_secret';
  }

  getAuthHeader() {
    const authString = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    return { Authorization: `Basic ${authString}` };
  }

  async createOrder({ amount, currency = 'INR', transactionId, planDetails }) {
    if (!this.keyId || !this.keySecret) {
      throw new Error("Razorpay API credentials (Key ID and Key Secret) are not configured.");
    }

    const amountInSubunits = Math.round(Number(amount) * 100);

    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      {
        amount: amountInSubunits,
        currency: currency.toUpperCase(),
        receipt: transactionId,
        notes: {
          planName: planDetails?.name || 'SaaS Plan',
          planId: String(planDetails?.id || ''),
          transactionId
        }
      },
      { headers: this.getAuthHeader() }
    );

    return {
      provider: 'RAZORPAY',
      providerOrderId: response.data.id,
      keyId: this.keyId,
      amount: amountInSubunits,
      currency: response.data.currency,
      transactionId
    };
  }

  async verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return { success: false, message: "Missing Razorpay verification parameters" };
    }

    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(body.toString())
      .digest('hex');

    const isValid = expectedSignature === razorpaySignature;

    return {
      success: isValid,
      providerPaymentId: razorpayPaymentId,
      providerOrderId: razorpayOrderId,
      message: isValid ? "Razorpay signature verified successfully" : "Invalid Razorpay payment signature"
    };
  }

  async verifyWebhook(req) {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return { success: false, message: "Missing Razorpay webhook signature header" };
    }

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const isValid = expectedSignature === signature;
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    return {
      success: isValid,
      event: payload?.event,
      payload
    };
  }

  async processRefund({ providerPaymentId, amount }) {
    if (!providerPaymentId) {
      throw new Error("Provider payment ID is required for Razorpay refund");
    }

    const payload = {};
    if (amount) {
      payload.amount = Math.round(Number(amount) * 100);
    }

    const response = await axios.post(
      `https://api.razorpay.com/v1/payments/${providerPaymentId}/refund`,
      payload,
      { headers: this.getAuthHeader() }
    );

    return {
      success: true,
      refundId: response.data.id,
      amount: response.data.amount / 100,
      status: response.data.status
    };
  }
}
