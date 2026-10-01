import {
  createPlanService,
  listPlansService,
  updatePlanService,
  deletePlanService,
  getPlansByBranchService
} from "./plan.service.js";
import { pool } from "../../config/db.js";
import { logAudit } from "../auditLog/auditLog.service.js";

export const createPlan = async (req, res, next) => {
  try {
    const plan = await createPlanService(req.body);

    logAudit({
      req,
      adminId: req.user?.adminId || req.user?.id,
      action: "PLAN_CREATE",
      module: "PLANS",
      resourceType: "Plan",
      resourceId: plan?.id,
      description: `Created new plan: ${req.body.name || plan?.name || 'Plan'} (Price: ${req.body.price || plan?.price || 0})`,
      status: "SUCCESS",
      severity: "INFO",
      newValue: req.body
    });

    res.json({ success: true, plan });
  } catch (err) {
    next(err);
  }
};

export const listPlans = async (req, res, next) => {
  try {
    const { duration, type } = req.query; // ?duration=Monthly&type=SAAS

    const plans = await listPlansService(duration, type);

    res.json({ success: true, plans });
  } catch (err) {
    next(err);
  }
};


export const getPlansByBranch = async (req, res, next) => {
  try {
    const { branchId } = req.params;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "branchId is required",
      });
    }

    const plans = await getPlansByBranchService(branchId);

    res.json({
      success: true,
      plans,
    });

  } catch (err) {
    next(err);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid plan ID" });
    }

    const updatedPlan = await updatePlanService(id, req.body);

    logAudit({
      req,
      adminId: req.user?.adminId || req.user?.id,
      action: "PLAN_UPDATE",
      module: "PLANS",
      resourceType: "Plan",
      resourceId: id,
      description: `Updated plan ID #${id} (${req.body.name || 'Plan'})`,
      status: "SUCCESS",
      severity: "INFO",
      newValue: req.body
    });

    res.json({
      success: true,
      message: "Plan updated successfully",
      plan: updatedPlan
    });
  } catch (err) {
    next(err);
  }
};

export const deletePlan = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid plan ID" });
    }

    await deletePlanService(id);

    logAudit({
      req,
      adminId: req.user?.adminId || req.user?.id,
      action: "PLAN_DELETE",
      module: "PLANS",
      resourceType: "Plan",
      resourceId: id,
      description: `Deleted plan ID #${id}`,
      status: "SUCCESS",
      severity: "WARNING"
    });

    res.json({ success: true, message: "Plan deleted" });
  } catch (err) {
    next(err);
  }
};
export const getSuperAdminContact = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.phone, u.email, u.fullName
       FROM user u
       JOIN role r ON r.id = u.roleId
       WHERE r.name = 'Superadmin'
       AND u.phone IS NOT NULL
       LIMIT 1`
    );
    const contact = rows[0] || { phone: null, email: null, fullName: 'Super Admin' };
    res.json({ success: true, contact });
  } catch (err) {
    next(err);
  }
};
