import { pool } from "../../config/db.js";

// Helper to mask sensitive keys before storing
const MASKED_KEYS = [
  "password",
  "oldPassword",
  "newPassword",
  "confirmPassword",
  "token",
  "authToken",
  "jwtSecret",
  "secret",
  "secretKey",
  "apiKey",
  "webhookSecret",
  "cardNumber",
  "cvv",
  "otp",
  "resetToken"
];

const maskSensitiveData = (data) => {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map(maskSensitiveData);

  const cleaned = {};
  for (const [key, value] of Object.entries(data)) {
    if (MASKED_KEYS.some((m) => key.toLowerCase().includes(m.toLowerCase()))) {
      cleaned[key] = "********";
    } else if (value && typeof value === "object") {
      cleaned[key] = maskSensitiveData(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

// ── Ensure Audit Log Table Exists ──
let tableEnsured = false;
export const ensureAuditLogTable = async () => {
  if (tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenantId INT NULL,
        adminId INT NULL,
        userId INT NULL,
        userName VARCHAR(255) NULL,
        userEmail VARCHAR(255) NULL,
        userRole VARCHAR(100) NULL,
        action VARCHAR(100) NOT NULL,
        module VARCHAR(100) NOT NULL,
        resourceType VARCHAR(100) NULL,
        resourceId VARCHAR(100) NULL,
        description TEXT NULL,
        ipAddress VARCHAR(100) NULL,
        userAgent VARCHAR(255) NULL,
        status ENUM('SUCCESS', 'FAILED') DEFAULT 'SUCCESS',
        severity ENUM('INFO', 'WARNING', 'CRITICAL') DEFAULT 'INFO',
        oldValue JSON NULL,
        newValue JSON NULL,
        metadata JSON NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_createdAt (createdAt),
        INDEX idx_userId (userId),
        INDEX idx_userEmail (userEmail),
        INDEX idx_action (action),
        INDEX idx_module (module),
        INDEX idx_status (status),
        INDEX idx_severity (severity),
        INDEX idx_ipAddress (ipAddress)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    tableEnsured = true;
  } catch (err) {
    console.error("❌ Failed to ensure audit_log table:", err.message);
  }
};

// Trigger table creation at module load
ensureAuditLogTable();

// ── Log Audit Event Service (Non-blocking) ──
export const logAudit = async ({
  req = null,
  tenantId = null,
  adminId = null,
  userId = null,
  userName = null,
  userEmail = null,
  userRole = null,
  action = "UNKNOWN_ACTION",
  module = "SYSTEM",
  resourceType = null,
  resourceId = null,
  description = null,
  status = "SUCCESS",
  severity = "INFO",
  oldValue = null,
  newValue = null,
  metadata = null,
}) => {
  try {
    await ensureAuditLogTable();

    // Extract user info from req if available
    let resolvedUserId = userId;
    let resolvedUserName = userName;
    let resolvedUserEmail = userEmail;
    let resolvedUserRole = userRole;
    let resolvedAdminId = adminId;
    let resolvedTenantId = tenantId;
    let ipAddress = null;
    let userAgent = null;

    if (req) {
      if (req.user) {
        resolvedUserId = resolvedUserId || req.user.id;
        resolvedUserName = resolvedUserName || req.user.fullName || req.user.name;
        resolvedUserEmail = resolvedUserEmail || req.user.email;
        resolvedUserRole = resolvedUserRole || req.user.role || req.user.roleName;
        resolvedAdminId = resolvedAdminId || req.user.adminId || req.user.id;
      }
      ipAddress = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || null;
      if (ipAddress && ipAddress.includes(",")) {
        ipAddress = ipAddress.split(",")[0].trim();
      }
      userAgent = req.headers["user-agent"] || null;
      if (userAgent && userAgent.length > 250) {
        userAgent = userAgent.slice(0, 250);
      }
    }

    const cleanOld = oldValue ? JSON.stringify(maskSensitiveData(oldValue)) : null;
    const cleanNew = newValue ? JSON.stringify(maskSensitiveData(newValue)) : null;
    const cleanMeta = metadata ? JSON.stringify(maskSensitiveData(metadata)) : null;

    const sql = `
      INSERT INTO audit_log (
        tenantId, adminId, userId, userName, userEmail, userRole,
        action, module, resourceType, resourceId, description,
        ipAddress, userAgent, status, severity, oldValue, newValue, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await pool.query(sql, [
      resolvedTenantId || null,
      resolvedAdminId || null,
      resolvedUserId || null,
      resolvedUserName || "System/Guest",
      resolvedUserEmail || "N/A",
      resolvedUserRole || "System",
      action,
      module,
      resourceType || null,
      resourceId ? String(resourceId) : null,
      description || `${action} executed on ${module}`,
      ipAddress,
      userAgent,
      status,
      severity,
      cleanOld,
      cleanNew,
      cleanMeta,
    ]);
  } catch (err) {
    console.error("⚠️ Audit Log failed (non-blocking):", err.message);
  }
};

// ── Get Paginated Audit Logs ──
export const getAuditLogsService = async ({
  adminId = null,
  startDate = null,
  endDate = null,
  module = null,
  action = null,
  status = null,
  severity = null,
  userEmail = null,
  search = null,
  page = 1,
  limit = 15,
  sortBy = "createdAt",
  sortOrder = "DESC",
}) => {
  await ensureAuditLogTable();

  const whereClauses = [];
  const queryParams = [];

  if (adminId && Number(adminId) > 0) {
    whereClauses.push("(adminId = ? OR adminId IS NULL)");
    queryParams.push(adminId);
  }

  if (startDate) {
    whereClauses.push("createdAt >= ?");
    queryParams.push(`${startDate} 00:00:00`);
  }

  if (endDate) {
    whereClauses.push("createdAt <= ?");
    queryParams.push(`${endDate} 23:59:59`);
  }

  if (module && module !== "ALL") {
    whereClauses.push("module = ?");
    queryParams.push(module);
  }

  if (action && action !== "ALL") {
    whereClauses.push("action = ?");
    queryParams.push(action);
  }

  if (status && status !== "ALL") {
    whereClauses.push("status = ?");
    queryParams.push(status);
  }

  if (severity && severity !== "ALL") {
    whereClauses.push("severity = ?");
    queryParams.push(severity);
  }

  if (userEmail && userEmail.trim() !== "") {
    whereClauses.push("userEmail LIKE ?");
    queryParams.push(`%${userEmail.trim()}%`);
  }

  if (search && search.trim() !== "") {
    const s = `%${search.trim()}%`;
    whereClauses.push(
      "(userName LIKE ? OR userEmail LIKE ? OR action LIKE ? OR module LIKE ? OR description LIKE ? OR ipAddress LIKE ? OR resourceId LIKE ?)"
    );
    queryParams.push(s, s, s, s, s, s, s);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Count Query
  const countSQL = `SELECT COUNT(*) AS total FROM audit_log ${whereSQL}`;
  const [[{ total }]] = await pool.query(countSQL, queryParams);

  // Sorting & Pagination
  const allowedSortCols = ["createdAt", "userName", "userEmail", "action", "module", "status", "severity"];
  const safeSortBy = allowedSortCols.includes(sortBy) ? sortBy : "createdAt";
  const safeOrder = sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";

  const safePage = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 15));
  const offset = (safePage - 1) * safeLimit;

  const logsSQL = `
    SELECT id, tenantId, adminId, userId, userName, userEmail, userRole,
           action, module, resourceType, resourceId, description,
           ipAddress, userAgent, status, severity, oldValue, newValue, metadata, createdAt
    FROM audit_log
    ${whereSQL}
    ORDER BY ${safeSortBy} ${safeOrder}
    LIMIT ? OFFSET ?
  `;

  const [logs] = await pool.query(logsSQL, [...queryParams, safeLimit, offset]);

  return {
    logs,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};

// ── Get Summary Stats ──
export const getAuditStatsService = async (adminId = null) => {
  await ensureAuditLogTable();

  const adminCondition = adminId && Number(adminId) > 0 ? "WHERE (adminId = ? OR adminId IS NULL)" : "";
  const params = adminId && Number(adminId) > 0 ? [adminId] : [];

  const [[{ totalEvents }]] = await pool.query(`SELECT COUNT(*) AS totalEvents FROM audit_log ${adminCondition}`, params);

  const todayCondition = adminCondition
    ? `${adminCondition} AND DATE(createdAt) = CURDATE()`
    : "WHERE DATE(createdAt) = CURDATE()";
  const [[{ eventsToday }]] = await pool.query(`SELECT COUNT(*) AS eventsToday FROM audit_log ${todayCondition}`, params);

  const failedCondition = adminCondition
    ? `${adminCondition} AND status = 'FAILED'`
    : "WHERE status = 'FAILED'";
  const [[{ failedEvents }]] = await pool.query(`SELECT COUNT(*) AS failedEvents FROM audit_log ${failedCondition}`, params);

  const criticalCondition = adminCondition
    ? `${adminCondition} AND severity = 'CRITICAL'`
    : "WHERE severity = 'CRITICAL'";
  const [[{ criticalEvents }]] = await pool.query(`SELECT COUNT(*) AS criticalEvents FROM audit_log ${criticalCondition}`, params);

  const activeUsersCondition = adminCondition
    ? `${adminCondition} AND createdAt >= NOW() - INTERVAL 24 HOUR AND userId IS NOT NULL`
    : "WHERE createdAt >= NOW() - INTERVAL 24 HOUR AND userId IS NOT NULL";
  const [[{ activeUsers }]] = await pool.query(`SELECT COUNT(DISTINCT userId) AS activeUsers FROM audit_log ${activeUsersCondition}`, params);

  return {
    totalEvents: Number(totalEvents || 0),
    eventsToday: Number(eventsToday || 0),
    failedEvents: Number(failedEvents || 0),
    criticalEvents: Number(criticalEvents || 0),
    activeUsers: Number(activeUsers || 0),
  };
};

// ── Get Single Audit Log Details ──
export const getAuditLogByIdService = async (id) => {
  await ensureAuditLogTable();
  const [rows] = await pool.query(`SELECT * FROM audit_log WHERE id = ?`, [id]);
  if (rows.length === 0) throw { status: 404, message: "Audit log entry not found" };
  return rows[0];
};

// ── Export Audit Logs to CSV Array ──
export const getAuditLogsForExportService = async (params) => {
  const result = await getAuditLogsService({ ...params, page: 1, limit: 5000 });
  return result.logs;
};
