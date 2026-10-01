import { pool } from "../../config/db.js";

// Ensure table exists safely
const ensureExpenseTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expense (
        id INT AUTO_INCREMENT PRIMARY KEY,
        adminId INT NULL,
        branchId INT NULL,
        title VARCHAR(191) DEFAULT 'Expense',
        category VARCHAR(100) DEFAULT 'Miscellaneous',
        description VARCHAR(255) NULL,
        amount DECIMAL(10,2) DEFAULT 0,
        date DATE,
        paymentMode VARCHAR(50) DEFAULT 'Cash',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure columns exist if table schema differs
    await pool.query(`ALTER TABLE expense ADD COLUMN adminId INT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE expense ADD COLUMN description VARCHAR(255) NULL`).catch(() => {});
    await pool.query(`ALTER TABLE expense ADD COLUMN title VARCHAR(191) DEFAULT 'Expense'`).catch(() => {});
    await pool.query(`ALTER TABLE expense ADD COLUMN category VARCHAR(100) DEFAULT 'Miscellaneous'`).catch(() => {});
    await pool.query(`ALTER TABLE expense ADD COLUMN paymentMode VARCHAR(50) DEFAULT 'Cash'`).catch(() => {});
  } catch (err) {
    console.error("ensureExpenseTable error:", err.message);
  }
};

// Resolve valid branch ID to prevent foreign key errors
const resolveBranchId = async (branchId, adminId) => {
  if (branchId && Number(branchId) > 0) {
    const [exists] = await pool.query(`SELECT id FROM branch WHERE id = ?`, [branchId]);
    if (exists.length > 0) return Number(branchId);
  }
  if (!adminId) return null;
  const [defaultBranch] = await pool.query(`SELECT id FROM branch WHERE adminId = ? ORDER BY id DESC LIMIT 1`, [adminId]);
  return defaultBranch.length > 0 ? defaultBranch[0].id : null;
};

// ----- ADD EXPENSE -----
export const addExpenseService = async (data) => {
  await ensureExpenseTable();
  const validBranchId = await resolveBranchId(data.branchId, data.adminId);
  const { title = "", category = "Miscellaneous", description = "", amount = 0, date = new Date(), paymentMode = "Cash" } = data;
  const descText = description || title || "";
  const titleText = title || description || category || "Operating Expense";
  const sql = `
    INSERT INTO expense (adminId, branchId, title, description, category, amount, date, paymentMode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await pool.query(sql, [data.adminId || null, validBranchId, titleText, descText, category, amount, date, paymentMode]);

  const [expense] = await pool.query(
    `SELECT e.*, IFNULL(e.description, e.title) AS description, IFNULL(b.name, 'Main Branch') AS branchName 
     FROM expense e 
     LEFT JOIN branch b ON e.branchId = b.id 
     WHERE e.id = ?`,
    [result.insertId]
  );

  return expense[0];
};

// ----- LIST EXPENSES (Including Auto Salaries) -----
export const listExpensesService = async (adminId, branchId, startDate, endDate) => {
  await ensureExpenseTable();
  const sql = `
    SELECT e.*, IFNULL(e.description, IFNULL(e.title, e.category)) AS description, IFNULL(b.name, 'Main Branch') AS branchName
    FROM expense e
    LEFT JOIN branch b ON e.branchId = b.id
    WHERE (? = 0 OR e.branchId = ? OR e.branchId IS NULL) 
      AND (e.adminId = ? OR b.adminId = ? OR ? IS NULL OR ? = 0) 
      AND e.date BETWEEN ? AND ?
    ORDER BY e.date DESC, e.id DESC
  `;
  const [expenses] = await pool.query(sql, [
    branchId || 0,
    branchId || 0,
    adminId,
    adminId,
    adminId,
    adminId,
    startDate,
    endDate
  ]);

  // Also fetch Staff Salaries within this period as automatic expense entries
  const [salaries] = await pool.query(
    `SELECT 
       id,
       staffId,
       role,
       periodStart,
       periodEnd AS date,
       netPay AS amount,
       'Staff Salary' AS category,
       CONCAT('Auto Salary: ', role, ' (Staff ID #', staffId, ')') AS description,
       'Bank/Payroll' AS paymentMode,
       'AUTO_SALARY' AS source
     FROM salary
     INNER JOIN staff ON salary.staffId = staff.id
     WHERE staff.adminId = ? AND salary.periodEnd BETWEEN ? AND ?`,
    [adminId, startDate, endDate]
  ).catch(() => [[]]);

  const combined = [
    ...expenses.map((e) => ({ ...e, source: "MANUAL", description: e.description || e.title || e.category })),
    ...(salaries || []).map((s) => ({ ...s, branchName: "All Staff" })),
  ];

  combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  return combined;
};

// ----- MONTHLY EXPENSES WITH SUMMARY -----
export const getMonthlyExpensesService = async (adminId, branchId, monthStr) => {
  await ensureExpenseTable();
  
  let year, month;
  if (monthStr && monthStr.includes("-")) {
    const parts = monthStr.split("-");
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")} 23:59:59`;

  const expenses = await listExpensesService(adminId, branchId || 0, startDate, endDate);

  let autoSalaryTotal = 0;
  let manualOperatingTotal = 0;

  expenses.forEach((item) => {
    const amt = Number(item.amount) || 0;
    if (item.source === "AUTO_SALARY") {
      autoSalaryTotal += amt;
    } else {
      manualOperatingTotal += amt;
    }
  });

  const totalExpenses = autoSalaryTotal + manualOperatingTotal;

  return {
    expenses,
    summary: {
      totalExpenses,
      autoSalaryTotal,
      manualOperatingTotal
    }
  };
};

// ----- MONTHLY EXPENSE SUMMARY -----
export const monthlyExpenseSummaryService = async (adminId, branchId) => {
  await ensureExpenseTable();
  const sql = `
    SELECT DATE_FORMAT(e.date, '%Y-%m') AS month, SUM(e.amount) AS total
    FROM expense e
    LEFT JOIN branch b ON e.branchId = b.id
    WHERE (? = 0 OR e.branchId = ?) AND (e.adminId = ? OR b.adminId = ?)
    GROUP BY DATE_FORMAT(e.date, '%Y-%m')
    ORDER BY month DESC
  `;
  const [summary] = await pool.query(sql, [branchId || 0, branchId || 0, adminId, adminId]);
  return summary;
};
