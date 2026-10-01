import { pool } from "./src/config/db.js";
import bcrypt from "bcryptjs";

async function run() {
  const defaultHash = await bcrypt.hash("123456", 10);
  
  // Check superadmin
  const [superadmins] = await pool.query("SELECT * FROM user WHERE email = 'superadmin@gmail.com' OR roleId = 1");
  console.log("Superadmins found:", superadmins);
  
  if (superadmins.length === 0) {
    // Insert a superadmin if none exists
    await pool.query(
      `INSERT INTO user (fullName, email, password, roleId, status, isVerified) 
       VALUES ('Super Admin', 'superadmin@gmail.com', ?, 1, 'Active', 1)`,
      [defaultHash]
    );
    console.log("Created superadmin: superadmin@gmail.com / 123456");
  } else {
    await pool.query(
      "UPDATE user SET password = ?, status = 'Active', isVerified = 1 WHERE id = ?",
      [defaultHash, superadmins[0].id]
    );
    console.log(`Updated superadmin (${superadmins[0].email}): password reset to 123456`);
  }

  // Check manager
  const [managers] = await pool.query("SELECT u.*, r.name as roleName FROM user u JOIN role r ON u.roleId = r.id WHERE r.name LIKE '%manager%'");
  console.log("Managers found:", managers);

  // Check roles table
  const [roles] = await pool.query("SELECT * FROM role");
  console.log("All roles in DB:", roles);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
