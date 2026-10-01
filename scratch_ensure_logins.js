import { pool } from "./src/config/db.js";
import bcrypt from "bcryptjs";

async function run() {
  try {
    const defaultHash = await bcrypt.hash("123456", 10);

    const rolesQuery = `
      SELECT r.id as roleId, r.name as roleName, u.id as userId, u.fullName, u.email, u.status
      FROM role r
      LEFT JOIN user u ON u.roleId = r.id AND u.status = 'Active'
      ORDER BY r.id, u.id
    `;

    const [rows] = await pool.query(rolesQuery);

    const roleMap = {};
    for (const row of rows) {
      if (!roleMap[row.roleName]) {
        roleMap[row.roleName] = [];
      }
      if (row.email) {
        roleMap[row.roleName].push(row);
      }
    }

    console.log("=== Active Users by Role ===");
    for (const [role, users] of Object.entries(roleMap)) {
      console.log(`\n--- ROLE: ${role.toUpperCase()} ---`);
      if (users.length === 0) {
        console.log("No active users found.");
      } else {
        for (const u of users.slice(0, 3)) {
          // Set password to 123456 for these sample accounts to ensure they work 100%
          await pool.query("UPDATE user SET password = ? WHERE id = ?", [defaultHash, u.userId]);
          console.log(`Email: ${u.email} | Name: ${u.fullName} | Password: 123456`);
        }
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
