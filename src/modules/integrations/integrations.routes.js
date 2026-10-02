import express from "express";
import {
  getIntegrations,
  updateRazorpay,
  updateBrevo,
  updateSmtp,
  testRazorpay,
  testBrevo,
  testSmtp,
  updateAdminUPI,
  getWhatsAppStatus,
  connectWhatsApp,
  confirmWhatsAppScan,
  disconnectWhatsApp
} from "./integrations.controller.js";
import { verifyToken } from "../../middlewares/auth.js";

const router = express.Router();

// Apply auth middleware to all integration routes (Requires Admin/SuperAdmin)
router.use(verifyToken(["ADMIN", "SUPERADMIN"]));

router.get("/", getIntegrations);

router.put("/razorpay", updateRazorpay);
router.post("/razorpay/test", testRazorpay);

router.put("/brevo", updateBrevo);
router.post("/brevo/test", testBrevo);

router.put("/smtp", updateSmtp);
router.post("/smtp/test", testSmtp);

router.put("/upi", updateAdminUPI);

// WhatsApp Routes
router.get("/whatsapp", getWhatsAppStatus);
router.post("/whatsapp/connect", connectWhatsApp);
router.post("/whatsapp/confirm-scan", confirmWhatsAppScan);
router.post("/whatsapp/disconnect", disconnectWhatsApp);

export default router;


