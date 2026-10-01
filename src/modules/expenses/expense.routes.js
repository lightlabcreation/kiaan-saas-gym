import { Router } from "express";
import { verifyToken } from "../../middlewares/auth.js";
import {
  addExpense,
  listExpenses,
  getMonthlyExpenses,
  expenseSummary,
} from "./expense.controller.js";

const router = Router();

// Create Expense
router.post(
  "/create",
  verifyToken(["Admin", "Superadmin", "Subadmin", "Manager"]),
  addExpense
);

// Get Monthly Expenses (including auto salaries & summary)
router.get(
  "/monthly",
  verifyToken(["Admin", "Superadmin", "Subadmin", "Manager"]),
  getMonthlyExpenses
);

// List branch expenses
router.get(
  "/branch/:branchId",
  verifyToken(["Admin", "Superadmin", "Subadmin", "Manager"]),
  listExpenses
);

// Monthly summary for graphs
router.get(
  "/summary/:branchId",
  verifyToken(["Admin", "Superadmin", "Subadmin", "Manager"]),
  expenseSummary
);

export default router;
