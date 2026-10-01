import { Router } from "express";
import {
  getAvailableMethods,
  createPaymentOrder,
  verifyPayment,
  handlePayUCallback,
  handleWebhook,
  getTransactions,
  getAdminGateways,
  updateAdminGateway,
  refundPayment
} from "./payment.controller.js";

const router = Router();

// Public & Methods endpoints
router.get("/methods/available", getAvailableMethods);
router.post("/create-order", createPaymentOrder);
router.post("/verify", verifyPayment);
router.all("/verify/payu-callback", handlePayUCallback);

// Webhook endpoint (Raw body or JSON parsed)
router.all("/webhook/:provider", handleWebhook);

// History & Admin Gateway endpoints
router.get("/transactions", getTransactions);
router.get("/admin/gateways", getAdminGateways);
router.put("/admin/gateways", updateAdminGateway);
router.post("/refund", refundPayment);

export default router;
