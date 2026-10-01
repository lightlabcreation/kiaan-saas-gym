/**
 * Base Payment Provider Interface
 */
export class BasePaymentProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Create an order or payment intent
   * @param {Object} params { amount, currency, orderId, planDetails, userDetails }
   */
  async createOrder(params) {
    throw new Error("createOrder() method must be implemented by provider");
  }

  /**
   * Verify server-side payment response / signature
   * @param {Object} payload 
   */
  async verifyPayment(payload) {
    throw new Error("verifyPayment() method must be implemented by provider");
  }

  /**
   * Verify webhook event & payload signature
   * @param {Object} req Express request
   */
  async verifyWebhook(req) {
    throw new Error("verifyWebhook() method must be implemented by provider");
  }

  /**
   * Process refund via provider API
   * @param {Object} params { providerPaymentId, amount, reason }
   */
  async processRefund(params) {
    throw new Error("processRefund() method must be implemented by provider");
  }
}
