import {
  addExpenseService,
  listExpensesService,
  getMonthlyExpensesService,
  monthlyExpenseSummaryService,
} from "./expense.service.js";

export const addExpense = async (req, res, next) => {
  try {
    const adminId = req.user?.adminId || req.user?.id;
    const expense = await addExpenseService({ ...req.body, adminId });
    res.json({ success: true, expense });
  } catch (err) {
    next(err);
  }
};

export const listExpenses = async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.branchId);
    const { from, to } = req.query;

    const startDate = from ? new Date(from) : new Date("2000-01-01");
    const endDate = to ? new Date(to) : new Date();

    const adminId = req.user?.adminId || req.user?.id;
    const list = await listExpensesService(adminId, branchId, startDate, endDate);
    res.json({ success: true, expenses: list });
  } catch (err) {
    next(err);
  }
};

export const getMonthlyExpenses = async (req, res, next) => {
  try {
    const adminId = req.user?.adminId || req.user?.id;
    const branchId = req.query.branchId ? parseInt(req.query.branchId) : 0;
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const data = await getMonthlyExpensesService(adminId, branchId, month);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

export const expenseSummary = async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.branchId);
    const adminId = req.user?.adminId || req.user?.id;
    const summary = await monthlyExpenseSummaryService(adminId, branchId);
    res.json({ success: true, summary });
  } catch (err) {
    next(err);
  }
};
