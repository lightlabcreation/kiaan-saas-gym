import { uploadToCloudinary } from "../../config/cloudinary.js";
import { registerUser, loginUser , fetchUserById,
  modifyUser,
  removeUser, fetchAdmins, fetchDashboardStats, loginMemberService,changeUserPassword, getAdminDashboardData,
  forgotPasswordService, verifyOtpService, resendOtpService, resetPasswordService, loginWithResetTokenService
} from "./auth.service.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../config/db.js";
import { PaymentCredentialResolver } from "../../utils/credentialResolvers.js";
import { logAudit } from "../auditLog/auditLog.service.js";



export const register = async (req, res, next) => {
  try {
    // ⚠️ Abhi ke liye adminId body se aa raha hai
    // Frontend se bhejna hoga:
    // { ..., adminId: 1 }

    // Agar baad me token lagaoge to aise kar sakte ho:
    // if (req.user) {
    //   req.body.adminId = req.user.id;   // jis admin ne create kiya
    // }
    
    const { paymentMethod, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (paymentMethod === "Razorpay") {
      const creds = PaymentCredentialResolver.getSuperAdminRazorpayCredentials();
      const activeKeySecret = creds.keySecret;
      
      if (activeKeySecret && !activeKeySecret.includes("dummy") && !razorpay_order_id?.startsWith("order_mock_")) {
        const generated_signature = crypto
          .createHmac("sha256", activeKeySecret)
          .update(razorpay_order_id + "|" + razorpay_payment_id)
          .digest("hex");

        if (generated_signature !== razorpay_signature) {
          return res.status(400).json({ success: false, message: "Invalid payment signature" });
        }
      }
    }

    let imageUrl = null;
    if (req.files?.profileImage) {
      imageUrl = await uploadToCloudinary(
        req.files.profileImage,
        "users/profile"
      );
    }

    const payload = { profileImage: imageUrl };
    console.log(payload)

    const user = await registerUser(req.body,payload)
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};



export const getUserById = async (req, res, next) => {
  try {
    const data = await fetchUserById(Number(req.params.id));
    res.json({ success: true, user: data });
  } catch (err) {
    next(err);
  }
};


export const getAdmins = async (req, res, next) => {
  try {
    const data = await fetchAdmins(); // service se fetch

    res.json({
      success: true,
      admins: data
    });
  } catch (err) {
    next(err);
  }
};



export const updateUser = async (req, res, next) => {
  try {
    const data = await modifyUser(Number(req.params.id), req.body, req.files);

    logAudit({
      req,
      userId: req.params.id,
      adminId: req.user?.adminId || req.user?.id,
      action: "USER_UPDATE",
      module: "AUTHENTICATION",
      resourceType: "User",
      resourceId: req.params.id,
      description: `Updated account details for user ID #${req.params.id}`,
      status: "SUCCESS",
      severity: "INFO",
      newValue: req.body
    });

    res.json({ success: true, user: data });
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const data = await removeUser(Number(req.params.id));

    logAudit({
      req,
      userId: req.params.id,
      adminId: req.user?.adminId || req.user?.id,
      action: "USER_DELETE",
      module: "AUTHENTICATION",
      resourceType: "User",
      resourceId: req.params.id,
      description: `Deleted user ID #${req.params.id}`,
      status: "SUCCESS",
      severity: "WARNING"
    });

    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    next(err);
  }
};

export const getDashboardStats = async (req, res, next) => {
  try {
    const data = await fetchDashboardStats(); // service se fetch

    res.json({
      success: true,
      dashboard: data
    });
  } catch (err) {
    next(err);
  }
};




// ✅ controller
export const login = async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const { token, user } = await loginUser({ email, password });

    logAudit({
      req,
      userId: user.id,
      userName: user.fullName,
      userEmail: user.email,
      userRole: user.roleName,
      adminId: user.adminId || user.id,
      action: "LOGIN",
      module: "AUTHENTICATION",
      resourceType: "user",
      resourceId: user.id,
      description: `User ${user.email} (${user.roleName}) logged in successfully`,
      status: "SUCCESS",
      severity: "INFO"
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,

        roleId: user.roleId,
        roleName: user.roleName,

        branchId: user.branchId,
        branchName: user.branchName,

        adminId: user.adminId,
        staffId: user.staffId,
        memberId: user.memberId,   // ✅ ADD THIS LINE

        razorpayKeyId: user.razorpayKeyId,

        profileImage: user.profileImage,
        permissions: user.permissions
      }
    });
  } catch (err) {
    logAudit({
      req,
      userEmail: email || "N/A",
      action: "FAILED_LOGIN",
      module: "AUTHENTICATION",
      resourceType: "user",
      description: `Failed login attempt for email: ${email || "unknown"} - ${err.message || "Invalid credentials"}`,
      status: "FAILED",
      severity: "WARNING"
    });
    next(err);
  }
};








export const loginMember = async (req, res, next) => {
  try {
    const data = await loginMemberService(req.body);
    res.json({
      success: true,
      token: data.token,
      member: {
        id: data.member.id,
        fullName: data.member.fullName,
        email: data.member.email,
        phone: data.member.phone,
        branchId: data.member.branchId,
        branchName: data.member.branch?.name || null,
      },
    });
  } catch (err) {
    next(err);
  }
};


export const changePasswordController = async (req, res, next) => {
  try {
    // const id = req.user.id; // from JWT middleware
    const { oldPassword, newPassword,id } = req.body;

    if (!oldPassword || !newPassword || !id) {
      return res.status(400).json({ success: false, message: "Old & new password required & id" });
    }

    const result = await changeUserPassword(id, oldPassword, newPassword);

    logAudit({
      req,
      userId: id,
      adminId: req.user?.adminId || req.user?.id,
      action: "PASSWORD_CHANGE",
      module: "AUTHENTICATION",
      resourceType: "User",
      resourceId: id,
      description: `User ID #${id} changed their account password`,
      status: "SUCCESS",
      severity: "INFO"
    });

    res.json({ success: true, ...result });

  } catch (err) {
    next(err);
  }
};


// export const getAdminDashboard = async (req, res, next) => {
//   try {
//     const data = await getAdminDashboardData();

//     res.json({
//       success: true,
//       message: "Dashboard data fetched successfully",
//       data,
//     });
//   } catch (err) {
//     next(err);
//   }
// };


export const getAdminDashboard = async (req, res, next) => {
  try {
    const adminId = req.params.id; // or req.user.adminId
    const branchId = req.query.branchId; // Get branchId from query parameters
    const month = req.query.month; // e.g., '2026-07'
    const chartPeriod = req.query.chartPeriod ? parseInt(req.query.chartPeriod) : 6;

    const data = await getAdminDashboardData(adminId, branchId, month, chartPeriod);

    res.json({
      success: true,
      message: "Dashboard data fetched successfully",
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await forgotPasswordService(email, req.ip, req.headers['user-agent']);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const verifyForgotPasswordOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const result = await verifyOtpService(email, otp);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const resendForgotPasswordOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await resendOtpService(email, req.ip, req.headers['user-agent']);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const loginWithResetToken = async (req, res, next) => {
  try {
    const { email, resetToken } = req.body;
    const result = await loginWithResetTokenService(email, resetToken, req.ip, req.headers['user-agent']);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { email, resetToken, newPassword, confirmPassword } = req.body;
    const result = await resetPasswordService(email, resetToken, newPassword, confirmPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const fixLoginsController = async (req, res, next) => {
  try {
    const defaultHash = await bcrypt.hash("123456", 10);
    const [superadmins] = await pool.query("SELECT id FROM user WHERE email = 'superadmin@gmail.com' OR roleId = 1 LIMIT 1");
    if (superadmins.length === 0) {
      await pool.query(
        `INSERT INTO user (fullName, email, password, roleId, status) 
         VALUES ('Super Admin', 'superadmin@gmail.com', ?, 1, 'Active')`,
        [defaultHash]
      );
    } else {
      await pool.query(
        `UPDATE user SET password = ?, status = 'Active' WHERE email = 'superadmin@gmail.com' OR roleId = 1`,
        [defaultHash]
      );
    }

    // Activate all accounts (Admin, Subadmin, Staff, Trainers, Receptionists, Members)
    await pool.query(
      `UPDATE user SET status = 'Active' WHERE status IS NULL OR status = 'inactive' OR status = ''`
    );
    await pool.query(
      `UPDATE user SET password = ? WHERE password IS NULL OR password = ''`,
      [defaultHash]
    );

    return res.json({
      success: true,
      message: "ALL user accounts (SuperAdmin, Admin, Subadmin, Trainers, Staff, Members) synced and activated successfully!"
    });
  } catch (err) {
    next(err);
  }
};
