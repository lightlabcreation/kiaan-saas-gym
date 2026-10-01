import {
  getAuditLogsService,
  getAuditStatsService,
  getAuditLogByIdService,
  getAuditLogsForExportService,
} from "./auditLog.service.js";

// List Audit Logs
export const listAuditLogs = async (req, res, next) => {
  try {
    const isSuperAdmin = (req.user?.role || '').toUpperCase().includes('SUPERADMIN') || req.user?.roleId === 1;
    const adminId = isSuperAdmin ? (req.query.gymAdminId || req.query.adminId || null) : (req.user?.adminId || req.user?.id);
    const {
      startDate,
      endDate,
      module,
      action,
      status,
      severity,
      userEmail,
      search,
      page = 1,
      limit = 15,
      sortBy = "createdAt",
      sortOrder = "DESC",
    } = req.query;

    const data = await getAuditLogsService({
      adminId,
      startDate,
      endDate,
      module,
      action,
      status,
      severity,
      userEmail,
      search,
      page,
      limit,
      sortBy,
      sortOrder,
    });

    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

// Summary Stats
export const getAuditStats = async (req, res, next) => {
  try {
    const isSuperAdmin = (req.user?.role || '').toUpperCase().includes('SUPERADMIN') || req.user?.roleId === 1;
    const adminId = isSuperAdmin ? (req.query.gymAdminId || req.query.adminId || null) : (req.user?.adminId || req.user?.id);
    const stats = await getAuditStatsService(adminId);
    res.json({ success: true, stats });
  } catch (err) {
    next(err);
  }
};

// Single Audit Log Entry
export const getAuditLogById = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const log = await getAuditLogByIdService(id);
    res.json({ success: true, log });
  } catch (err) {
    next(err);
  }
};

// Export Audit Logs (CSV)
export const exportAuditLogs = async (req, res, next) => {
  try {
    const isSuperAdmin = (req.user?.role || '').toUpperCase().includes('SUPERADMIN') || req.user?.roleId === 1;
    const adminId = isSuperAdmin ? (req.query.gymAdminId || req.query.adminId || null) : (req.user?.adminId || req.user?.id);
    const logs = await getAuditLogsForExportService({ ...req.query, adminId });

    // Format rows as CSV string
    const headers = [
      "ID",
      "Timestamp",
      "User Name",
      "User Email",
      "User Role",
      "Action",
      "Module",
      "Resource Type",
      "Resource ID",
      "Status",
      "Severity",
      "IP Address",
      "Description"
    ];

    const csvRows = [headers.join(",")];

    logs.forEach((log) => {
      const row = [
        log.id,
        `"${new Date(log.createdAt).toISOString()}"`,
        `"${(log.userName || "").replace(/"/g, '""')}"`,
        `"${(log.userEmail || "").replace(/"/g, '""')}"`,
        `"${(log.userRole || "").replace(/"/g, '""')}"`,
        `"${(log.action || "").replace(/"/g, '""')}"`,
        `"${(log.module || "").replace(/"/g, '""')}"`,
        `"${(log.resourceType || "").replace(/"/g, '""')}"`,
        `"${(log.resourceId || "").replace(/"/g, '""')}"`,
        `"${log.status}"`,
        `"${log.severity}"`,
        `"${log.ipAddress || ""}"`,
        `"${(log.description || "").replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(","));
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=audit_logs_${new Date().toISOString().slice(0, 10)}.csv`);
    return res.send(csvRows.join("\n"));
  } catch (err) {
    next(err);
  }
};
