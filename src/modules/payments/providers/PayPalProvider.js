import axios from 'axios';
import { BasePaymentProvider } from './PaymentProvider.interface.js';

export class PayPalProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.clientId = config.keyId || process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = config.secretKey || process.env.PAYPAL_CLIENT_SECRET;
    this.isSandbox = config.isTestMode !== undefined ? config.isTestMode : true;
    this.baseUrl = this.isSandbox
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';
  }

  async getAccessToken() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("PayPal Client ID and Client Secret are not configured.");
    }

    const authString = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await axios.post(
      `${this.baseUrl}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data.access_token;
  }

  async createOrder({ amount, currency = 'USD', transactionId, planDetails }) {
    const accessToken = await this.getAccessToken();

    const response = await axios.post(
      `${this.baseUrl}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: transactionId,
            description: planDetails?.name || 'Gym SaaS Plan',
            amount: {
              currency_code: currency.toUpperCase(),
              value: Number(amount).toFixed(2)
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      provider: 'PAYPAL',
      providerOrderId: response.data.id,
      clientId: this.clientId,
      amount,
      currency,
      transactionId,
      approvalUrl: response.data.links?.find(l => l.rel === 'approve')?.href
    };
  }

  async verifyPayment({ paypalOrderId }) {
    if (!paypalOrderId) {
      return { success: false, message: "PayPal Order ID is required for capture" };
    }

    const accessToken = await this.getAccessToken();

    const response = await axios.post(
      `${this.baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const orderData = response.data;
    const isCompleted = orderData.status === 'COMPLETED';
    const capture = orderData.purchase_units?.[0]?.payments?.captures?.[0];

    return {
      success: isCompleted,
      providerPaymentId: capture?.id || orderData.id,
      providerOrderId: orderData.id,
      amount: capture?.amount?.value || 0,
      status: orderData.status,
      message: isCompleted ? "PayPal order captured successfully" : `PayPal status is ${orderData.status}`
    };
  }

  async verifyWebhook(req) {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    return {
      success: true,
      event: payload?.event_type,
      payload
    };
  }

  async processRefund({ providerPaymentId, amount }) {
    if (!providerPaymentId) {
      throw new Error("PayPal Capture ID is required for refund");
    }

    const accessToken = await this.getAccessToken();
    const payload = {};
    if (amount) {
      payload.amount = {
        value: Number(amount).toFixed(2),
        currency_code: 'USD'
      };
    }

    const response = await axios.post(
      `${this.baseUrl}/v2/payments/captures/${providerPaymentId}/refund`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      refundId: response.data.id,
      status: response.data.status
    };
  }
}
