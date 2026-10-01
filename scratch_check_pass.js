import { pool } from "./src/config/db.js";
import bcrypt from "bcryptjs";

async function check() {
  const [users] = await pool.query(
    "SELECT id, fullName, email, password FROM user WHERE email IN ('admin@gmail.com', 'superadmin@gmail.com', 'test@test.com')"
  );
  
  const passwordsToTest = ["123456", "admin123", "password", "12345678", "admin", "12345"];
  
  for (const u of users) {
    console.log(`\nUser: ${u.fullName} (${u.email})`);
    let matched = false;
    for (const p of passwordsToTest) {
      const match = await bcrypt.compare(p, u.password);
      if (match) {
        console.log(`  MATCH FOUND! Password is: "${p}"`);
        matched = true;
        break;
      }
    }
    if (!matched) {
      console.log(`  Hash: ${u.password.substring(0, 20)}... (No standard test password matched)`);
    }
  }
  process.exit(0);
}

check();
