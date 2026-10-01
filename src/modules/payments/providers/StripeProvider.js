import crypto from 'crypto';
import axios from 'axios';
import { BasePaymentProvider } from './PaymentProvider.interface.js';

export class StripeProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.publishableKey = config.keyId || process.env.STRIPE_PUBLISHABLE_KEY;
    this.secretKey = config.secretKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || 'whsec_stripe_secret';
  }

  getAuthHeader() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    };
  }

  async createOrder({ amount, currency = 'USD', transactionId, planDetails, userDetails }) {
    if (!this.secretKey) {
      throw new Error("Stripe Secret Key is not configured.");
    }

    const amountInSubunits = Math.round(Number(amount) * 100);

    const params = new URLSearchParams();
    params.append('amount', amountInSubunits.toString());
    params.append('currency', currency.toLowerCase());
    params.append('automatic_payment_methods[enabled]', 'true');
    params.append('metadata[transactionId]', transactionId);
    if (planDetails?.name) params.append('metadata[planName]', planDetails.name);
    if (planDetails?.id) params.append('metadata[planId]', String(planDetails.id));

    const response = await axios.post(
      'https://api.stripe.com/v1/payment_intents',
      params.toString(),
      { headers: this.getAuthHeader() }
    );

    return {
      provider: 'STRIPE',
      providerOrderId: response.data.id,
      clientSecret: response.data.client_secret,
      publishableKey: this.publishableKey,
      amount: amountInSubunits,
      currency: response.data.currency,
      transactionId
    };
  }

  async verifyPayment({ paymentIntentId, clientSecret }) {
    if (!paymentIntentId) {
      return { success: false, message: "Missing Stripe PaymentIntent ID" };
    }

    const response = await axios.get(
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`,
      { headers: this.getAuthHeader() }
    );

    const intent = response.data;
    const isSuccessful = intent.status === 'succeeded';

    return {
      success: isSuccessful,
      providerPaymentId: intent.id,
      providerOrderId: intent.id,
      amount: intent.amount / 100,
      status: intent.status,
      message: isSuccessful ? "Stripe PaymentIntent verified successfully" : `Payment status is ${intent.status}`
    };
  }

  async verifyWebhook(req) {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return { success: false, message: "Missing stripe-signature header" };
    }

    // Header format: t=timestamp,v1=signature
    const parts = signature.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=');
      acc[key] = value;
      return acc;
    }, {});

    const timestamp = parts.t;
    const expectedSig = parts.v1;
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const signedPayload = `${timestamp}.${rawBody}`;
    const hmac = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    const isValid = hmac === expectedSig;
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    return {
      success: isValid,
      event: payload?.type,
      payload
    };
  }

  async processRefund({ providerPaymentId, amount }) {
    if (!providerPaymentId) {
      throw new Error("Stripe PaymentIntent ID / Charge ID is required for refund");
    }

    const params = new URLSearchParams();
    params.append('payment_intent', providerPaymentId);
    if (amount) {
      params.append('amount', Math.round(Number(amount) * 100).toString());
    }

    const response = await axios.post(
      'https://api.stripe.com/v1/refunds',
      params.toString(),
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
