import crypto from 'crypto';
import axios from 'axios';
import { BasePaymentProvider } from './PaymentProvider.interface.js';

export class PhonePeProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.merchantId = config.keyId || process.env.PHONEPE_MERCHANT_ID || process.env.PHONEPE_KEY_ID;
    this.saltKey = config.secretKey || process.env.PHONEPE_SALT_KEY;
    this.saltIndex = config.webhookSecret || process.env.PHONEPE_SALT_INDEX || '1';
    this.isTestMode = config.isTestMode !== undefined ? config.isTestMode : true;
    this.baseUrl = this.isTestMode 
      ? 'https://api-preprod.phonepe.com/apis/pg-sandbox' 
      : 'https://api.phonepe.com/apis/hermes';
  }

  generateXVerify(base64Payload, apiEndpoint) {
    const stringToHash = base64Payload + apiEndpoint + this.saltKey;
    const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
    return `${sha256}###${this.saltIndex}`;
  }

  async createOrder({ amount, currency = 'INR', transactionId, userDetails }) {
    if (!this.merchantId || !this.saltKey) {
      throw new Error("PhonePe API credentials (Merchant ID and Salt Key) are not configured.");
    }

    const amountInPaise = Math.round(Number(amount) * 100);
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/my-subscription?txn=${transactionId}`;

    const payload = {
      merchantId: this.merchantId,
      merchantTransactionId: transactionId,
      merchantUserId: String(userDetails?.id || 'MUSER_1'),
      amount: amountInPaise,
      redirectUrl: redirectUrl,
      redirectMode: 'POST',
      callbackUrl: `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/payments/webhook/phonepe`,
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const apiEndpoint = '/pg/v1/pay';
    const xVerify = this.generateXVerify(base64Payload, apiEndpoint);

    const response = await axios.post(
      `${this.baseUrl}${apiEndpoint}`,
      { request: base64Payload },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': xVerify
        }
      }
    );

    const redirectInfo = response.data?.data?.instrumentResponse?.redirectInfo;

    return {
      provider: 'PHONEPE',
      providerOrderId: response.data?.data?.merchantTransactionId || transactionId,
      paymentUrl: redirectInfo?.url || null,
      amount: amountInPaise,
      currency: currency.toUpperCase(),
      transactionId
    };
  }

  async verifyPayment({ merchantTransactionId, transactionId }) {
    const txnId = merchantTransactionId || transactionId;
    if (!txnId) {
      return { success: false, message: "Transaction ID missing for PhonePe verification" };
    }

    try {
      const apiEndpoint = `/pg/v1/status/${this.merchantId}/${txnId}`;
      const stringToHash = apiEndpoint + this.saltKey;
      const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
      const xVerify = `${sha256}###${this.saltIndex}`;

      const response = await axios.get(`${this.baseUrl}${apiEndpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': xVerify,
          'X-MERCHANT-ID': this.merchantId
        }
      });

      const isSuccess = response.data.code === 'PAYMENT_SUCCESS';
      return {
        success: isSuccess,
        providerOrderId: txnId,
        providerPaymentId: response.data.data?.transactionId || txnId,
        amount: (response.data.data?.amount || 0) / 100,
        message: isSuccess ? "PhonePe payment verified successfully" : response.data.message
      };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || err.message };
    }
  }

  async verifyWebhook(req) {
    const xVerify = req.headers['x-verify'];
    if (!xVerify) {
      return { success: false, message: "Missing PhonePe X-VERIFY header" };
    }

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expectedHash = crypto.createHash('sha256').update(rawBody + this.saltKey).digest('hex') + `###${this.saltIndex}`;
    const isValid = expectedHash === xVerify;

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    return {
      success: isValid,
      event: payload?.code,
      payload
    };
  }

  async processRefund({ providerPaymentId, amount, reason }) {
    const refundTransactionId = `REFUND_${Date.now()}`;
    const apiEndpoint = '/pg/v1/refund';
    const amountInPaise = Math.round(Number(amount) * 100);

    const payload = {
      merchantId: this.merchantId,
      merchantTransactionId: refundTransactionId,
      originalTransactionId: providerPaymentId,
      amount: amountInPaise,
      callbackUrl: `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/payments/webhook/phonepe`
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const xVerify = this.generateXVerify(base64Payload, apiEndpoint);

    const response = await axios.post(
      `${this.baseUrl}${apiEndpoint}`,
      { request: base64Payload },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': xVerify
        }
      }
    );

    return {
      success: response.data?.code === 'PAYMENT_SUCCESS',
      refundId: refundTransactionId,
      amount: Number(amount),
      status: response.data?.code
    };
  }
}
