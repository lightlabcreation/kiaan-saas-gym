import { Router } from "express";
import {
  createPlan,
  listPlans,
  updatePlan,
  deletePlan,
  getPlansByBranch,
  getSuperAdminContact
} from "./plan.controller.js";
import { verifyToken } from "../../middlewares/auth.js";

const router = Router();

// Only Superadmin and Admin can manage plans
router.post(
  "/create",
  verifyToken(["Superadmin", "Admin", "Subadmin"]),
  createPlan
);

router.get(
  "/",
  listPlans
);

// Public: Get SuperAdmin contact info for Custom Plan
router.get("/superadmin-contact", getSuperAdminContact);

router.get(
  "/branch/:branchId",
  verifyToken(["Superadmin", "Admin", "Subadmin", "Staff", "Member"]),
  getPlansByBranch
);

router.put(
  "/update/:id",
  verifyToken(["Superadmin", "Admin", "Subadmin"]),
  updatePlan
);

router.delete(
  "/delete/:id",
  verifyToken(["Superadmin", "Admin", "Subadmin"]),
  deletePlan
);

export default router;
