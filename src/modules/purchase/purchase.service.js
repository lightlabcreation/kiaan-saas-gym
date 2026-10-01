import { pool } from "../../config/db.js";

// Create a new purchase
export const createPurchaseService = async (data) => {
  const { selectedPlan, companyName, email, billingDuration, startDate, amount, phone, adminName, branchName, gstNumber, city, profileImage, password, visiblePassword, paymentMethod, paymentDetails } = data;

  const validStartDate = (startDate && !isNaN(new Date(startDate).getTime())) ? new Date(startDate) : new Date();

  const [result] = await pool.query(
    `INSERT INTO purchase (selectedPlan, companyName, email, billingDuration, startDate, amount, phone, adminName, branchName, gstNumber, city, profileImage, password, visiblePassword, paymentMethod, paymentDetails) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [selectedPlan, companyName, email, billingDuration || 'Not Specified', validStartDate, amount || 0, phone || "", adminName || "", branchName || "", gstNumber || null, city || null, profileImage || null, password || null, visiblePassword || null, paymentMethod || null, paymentDetails || null]
  );

  const purchaseId = result.insertId;

  // Generate a unique, date-based transaction ID
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const paddedId = String(purchaseId).padStart(4, '0');
  const transactionId = `PAY-${yyyy}${mm}${dd}-${paddedId}`;

  // Save transactionId to the purchase record
  await pool.query(`UPDATE purchase SET transactionId = ? WHERE id = ?`, [transactionId, purchaseId]);

  const [purchase] = await pool.query(`SELECT * FROM purchase WHERE id = ?`, [purchaseId]);
  if (purchase[0]) {
    delete purchase[0].password;
    delete purchase[0].visiblePassword;
  }
  return purchase[0];
};

// Get all purchases
export const getAllPurchasesService = async (email) => {
  let query = `SELECT * FROM purchase`;
  const params = [];
  
  if (email) {
    query += ` WHERE email = ?`;
    params.push(email);
  }
  
  query += ` ORDER BY id DESC`;

  const [rows] = await pool.query(query, params);
  return rows.map(r => {
    delete r.password;
    delete r.visiblePassword;
    return r;
  });
};

// Modify purchase status
export const modifyPurchaseStatus = async (id, status) => {
  if (!status) throw { status: 400, message: "Status is required" };

  await pool.query(`UPDATE purchase SET status = ? WHERE id = ?`, [status, id]);
  const [updated] = await pool.query(`SELECT * FROM purchase WHERE id = ?`, [id]);
  if (updated[0]) {
    delete updated[0].password;
    delete updated[0].visiblePassword;
  }
  return updated[0];
};
