import crypto from 'crypto';
import axios from 'axios';
import { BasePaymentProvider } from './PaymentProvider.interface.js';

export class PayUProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.merchantKey = config.keyId || process.env.PAYU_MERCHANT_KEY;
    this.merchantSalt = config.merchantSalt || config.secretKey || process.env.PAYU_MERCHANT_SALT;
    this.isTestMode = config.isTestMode !== undefined ? config.isTestMode : true;
    this.baseUrl = this.isTestMode
      ? 'https://test.payu.in/_payment'
      : 'https://secure.payu.in/_payment';
    this.commandUrl = this.isTestMode
      ? 'https://test.payu.in/merchant/postservice?form=2'
      : 'https://info.payu.in/merchant/postservice?form=2';
  }

  generateHash(string) {
    return crypto.createHash('sha512').update(string).digest('hex');
  }

  async createOrder({ amount, currency = 'INR', transactionId, planDetails, userDetails }) {
    if (!this.merchantKey || !this.merchantSalt) {
      throw new Error("PayU Merchant Key and Merchant Salt are not configured.");
    }

    const txnid = transactionId;
    const amountStr = Number(amount).toFixed(2);
    const productinfo = planDetails?.name || 'SaaS Plan';
    const firstname = userDetails?.name || 'Customer';
    const email = userDetails?.email || 'customer@example.com';
    const udf1 = String(planDetails?.id || '');

    // Formula: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
    const hashSequence = `${this.merchantKey}|${txnid}|${amountStr}|${productinfo}|${firstname}|${email}|${udf1}||||||||||${this.merchantSalt}`;
    const hash = this.generateHash(hashSequence);

    return {
      provider: 'PAYU',
      actionUrl: this.baseUrl,
      merchantKey: this.merchantKey,
      txnid,
      amount: amountStr,
      currency,
      productinfo,
      firstname,
      email,
      udf1,
      hash,
      surl: `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/payments/verify/payu-callback`,
      furl: `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/payments/verify/payu-callback`
    };
  }

  async verifyPayment(payload) {
    const { key, txnid, amount, productinfo, firstname, email, status, hash, mihpayid, udf1 } = payload;

    if (!txnid || !status || !hash) {
      return { success: false, message: "Missing PayU verification parameters" };
    }

    // Response hash formula: SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
    const reverseHashSequence = `${this.merchantSalt}|${status}|||||||||${udf1 || ''}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${this.merchantKey || key}`;
    const expectedHash = this.generateHash(reverseHashSequence);

    const isHashValid = expectedHash === hash;
    const isSuccessStatus = status.toLowerCase() === 'success';

    return {
      success: isHashValid && isSuccessStatus,
      providerPaymentId: mihpayid || txnid,
      providerOrderId: txnid,
      amount: Number(amount),
      status: isSuccessStatus ? 'Successful' : 'Failed',
      message: (isHashValid && isSuccessStatus) ? "PayU hash verified successfully" : "PayU verification or status failed"
    };
  }

  async verifyWebhook(req) {
    const payload = req.body;
    const verification = await this.verifyPayment(payload);
    return {
      success: verification.success,
      event: payload?.status,
      payload
    };
  }

  async processRefund({ providerPaymentId, amount }) {
    if (!providerPaymentId) {
      throw new Error("PayU payment ID (mihpayid) is required for refund");
    }

    const command = 'cancel_refund_transaction';
    const hashString = `${this.merchantKey}|${command}|${providerPaymentId}|${this.merchantSalt}`;
    const hash = this.generateHash(hashString);

    const params = new URLSearchParams();
    params.append('key', this.merchantKey);
    params.append('command', command);
    params.append('hash', hash);
    params.append('var1', providerPaymentId);
    params.append('var2', String(Date.now()));
    params.append('var3', Number(amount).toFixed(2));

    const response = await axios.post(this.commandUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return {
      success: response.data.status === 1,
      refundId: response.data.request_id || providerPaymentId,
      rawResponse: response.data
    };
  }
}
