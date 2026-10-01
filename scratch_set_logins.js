import { pool } from "./src/config/db.js";
import bcrypt from "bcryptjs";

async function run() {
  const defaultHash = await bcrypt.hash("123456", 10);
  
  // Update passwords for key demo accounts
  const demoAccounts = [
    { role: 'SUPERADMIN', email: 'superadmin@gmail.com', roleId: 1, name: 'Super Admin' },
    { role: 'ADMIN', email: 'john@gmail.com', roleId: 2, name: 'John Admin' },
    { role: 'GENERALTRAINER', email: 'generaltrainer1@gym.com', roleId: 6, name: 'Default General Trainer' },
    { role: 'HOUSEKEEPING', email: 'housekeeping@gmail.com', roleId: 8, name: 'Default Housekeeping' },
    { role: 'MANAGER', email: 'piasubadmin@gmail.com', roleId: 9, name: 'Pia Subadmin / Manager' },
    { role: 'MEMBER', email: 'john.doe@example.com', roleId: 4, name: 'John Doe' },
    { role: 'PERSONALTRAINER', email: 'personal@gmail.com', roleId: 5, name: 'Default Personal Trainer' },
    { role: 'RECEPTIONIST', email: 'receptionist@gmail.com', roleId: 7, name: 'Default Receptionist' },
    { role: 'SALES_AGENT', email: 'salesagent@gmail.com', roleId: 10, name: 'Default Sales Agent' }
  ];

  console.log("Setting passwords for all demo accounts to 123456...");
  for (const acc of demoAccounts) {
    const [existing] = await pool.query("SELECT id FROM user WHERE email = ?", [acc.email]);
    if (existing.length > 0) {
      await pool.query("UPDATE user SET password = ?, status = 'Active' WHERE email = ?", [defaultHash, acc.email]);
    }
  }

  console.log("\n=======================================================");
  console.log("                 DEMO LOGIN CREDENTIALS                ");
  console.log("=======================================================");
  for (const acc of demoAccounts) {
    console.log(`[${acc.role}] -> Email: ${acc.email} | Password: 123456`);
  }
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
