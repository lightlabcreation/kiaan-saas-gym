import { pool } from "./src/config/db.js";
import bcrypt from "bcryptjs";

async function run() {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.fullName, u.email, u.password, u.roleId, r.name as roleName, u.status 
       FROM user u 
       LEFT JOIN role r ON u.roleId = r.id 
       ORDER BY u.roleId, u.id`
    );

    console.log("=== USERS IN DATABASE ===");
    for (const u of users) {
      const is123456 = u.password ? await bcrypt.compare("123456", u.password) : false;
      const isPassword = u.password ? await bcrypt.compare("password", u.password) : false;
      const isAdmin123 = u.password ? await bcrypt.compare("admin123", u.password) : false;
      const isPassword123 = u.password ? await bcrypt.compare("password123", u.password) : false;
      let matchedPass = is123456 ? "123456" : isPassword ? "password" : isAdmin123 ? "admin123" : isPassword123 ? "password123" : "Unknown / other hash";
      console.log(`Role: ${u.roleName || u.roleId} | Name: ${u.fullName} | Email: ${u.email} | Status: ${u.status} | Password: ${matchedPass}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
