import { Router } from "express";
import { verifyToken } from "../../middlewares/auth.js";
import {
  listAuditLogs,
  getAuditStats,
  getAuditLogById,
  exportAuditLogs,
} from "./auditLog.controller.js";

const router = Router();

// Middleware: restrict audit log routes to Admins & Superadmins
const auditAuth = verifyToken(["Admin", "Superadmin", "Subadmin"]);

router.get("/", auditAuth, listAuditLogs);
router.get("/stats", auditAuth, getAuditStats);
router.get("/export", auditAuth, exportAuditLogs);
router.get("/:id", auditAuth, getAuditLogById);

export default router;
