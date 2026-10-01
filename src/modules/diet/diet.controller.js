  import {
    createDietPlanService,
    getAllDietPlansService,
    updateDietPlanService,
    deleteDietPlanService,
    assignDietPlanService,
    getMemberDietPlanService
  } from "./diet.service.js";

  export const createDietPlan = async (req, res, next) => {
  try {
    const createdBy = req.user?.id || req.body.createdBy;
    const adminId = req.user?.adminId || (req.user?.roleId === 2 ? req.user?.id : null);
    const branchId = req.user?.branchId || req.body.branchId;
    const diet = await createDietPlanService({ ...req.body, createdBy, adminId, branchId });
    res.json({ success: true, diet });
  } catch (err) {
    next(err);
  }
};

export const getAllDietPlans = async (req, res, next) => {
  try {
    const queryBranchId = req.query.branchId;
    const queryCreatedBy = req.query.createdBy;
    const userId = req.user?.id;
    const userRoleId = req.user?.roleId;
    const adminId = req.user?.adminId || (userRoleId === 2 ? userId : null);
    const branchId = queryBranchId || req.user?.branchId;

    const plans = await getAllDietPlansService(branchId, queryCreatedBy || userId, adminId, userRoleId);
    res.json({ success: true, plans });
  } catch (err) {
    next(err);
  }
};

  export const updateDietPlan = async (req, res, next) => {
    try {
      const { id } = req.params;
      const diet = await updateDietPlanService(id, req.body);
      res.json({ success: true, diet });
    } catch (err) {
      next(err);
    }
  };

  export const deleteDietPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    await deleteDietPlanService(id);
    res.json({ success: true, message: "Diet plan deleted successfully" });
  } catch (err) {
    next(err);
  }
};

export const assignDietPlan = async (req, res, next) => {
  try {
    const { memberId, dietPlanId } = req.body;
    const a = await assignDietPlanService(memberId, dietPlanId);
    res.json({ success: true, assigned: a });
  } catch (err) {
    next(err);
  }
};

export const getMemberDietPlan = async (req, res, next) => {
  try {
    const memberId = parseInt(req.params.memberId);
    const plans = await getMemberDietPlanService(memberId);
    res.json({ success: true, plans });
  } catch (err) {
    next(err);
  }
};
