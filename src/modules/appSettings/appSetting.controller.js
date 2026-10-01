import { createAppSettingsService, deleteAppSettingsService, getAllAppSettingsService, getAppSettingsByAdminIdService, getAppSettingsByIdService, updateAppSettingsService } from "./appSetting.service.js";
import { logAudit } from "../auditLog/auditLog.service.js";

export const createAppSettingsController = async (req, res) => {
  try {
    const { adminId = null } = req.body;
    const file = req.files?.logo || null;

    const data = await createAppSettingsService(adminId, req.body, file);

    logAudit({
      req,
      adminId,
      action: "SETTINGS_CREATE",
      module: "SETTINGS",
      resourceType: "AppSettings",
      resourceId: data?.id,
      description: "Configured initial gym app settings",
      status: "SUCCESS",
      severity: "INFO"
    });

    res.status(201).json({
      success: true,
      message: "App settings created",
      data
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message
    });
  }
};

/* UPDATE */
export const updateAppSettingsController = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId = null, currency } = req.body;
    const file = req.files?.logo || null;

    const data = await updateAppSettingsService(id, adminId, req.body, file);

    logAudit({
      req,
      adminId: adminId || req.user?.adminId || req.user?.id,
      action: currency ? "CURRENCY_UPDATE" : "SETTINGS_UPDATE",
      module: "SETTINGS",
      resourceType: "AppSettings",
      resourceId: id,
      description: currency ? `Updated system currency preference to ${currency}` : `Updated gym profile and business details for settings #${id}`,
      status: "SUCCESS",
      severity: "INFO",
      newValue: req.body
    });

    res.json({
      success: true,
      message: "App settings updated",
      data
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message
    });
  }
};

/* DELETE */
export const deleteAppSettingsController = async (req, res) => {
  try {
    await deleteAppSettingsService(req.params.id);
    res.json({ success: true, message: "App settings deleted" });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message
    });
  }
};

/* GET BY ID */
export const getAppSettingsByIdController = async (req, res) => {
  try {
    const data = await getAppSettingsByIdService(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message
    });
  }
};

/* GET ALL */
export const getAllAppSettingsController = async (req, res) => {
  try {
    const data = await getAllAppSettingsService();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

export const getAppSettingsByAdminIdController = async (req, res) => {
  try {
    const { adminId } = req.params;

    const data = await getAppSettingsByAdminIdService(adminId);

    res.json({
      success: true,
      data
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message
    });
  }
};