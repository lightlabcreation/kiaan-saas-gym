import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

async function main() {
  try {
    const c = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
      database: 'gymsaas_db'
    });

    const hash = await bcrypt.hash('123456', 10);
    console.log('Generated hash for 123456:', hash);

    const [superRole] = await c.query("SELECT id FROM role WHERE LOWER(name) LIKE '%super%' LIMIT 1");
    const [adminRole] = await c.query("SELECT id FROM role WHERE LOWER(name) = 'admin' LIMIT 1");
    
    const sId = superRole[0]?.id;
    const aId = adminRole[0]?.id;

    console.log("SuperAdmin Role ID:", sId, "Admin Role ID:", aId);

    // Reset passwords to 123456
    await c.query(
      "UPDATE user SET password = ? WHERE email IN ('superadmin@gmail.com', 'test@test.com', 'admin@gmail.com', 'john@gmail.com')",
      [hash]
    );

    // Upsert superadmin@gmail.com
    const [existSuper] = await c.query("SELECT id FROM user WHERE email = 'superadmin@gmail.com'");
    if (existSuper.length === 0 && sId) {
      await c.query(
        "INSERT INTO user (fullName, email, password, roleId) VALUES (?, ?, ?, ?)",
        ['Super Admin', 'superadmin@gmail.com', hash, sId]
      );
    }

    // Upsert admin@gmail.com
    const [existAdmin] = await c.query("SELECT id FROM user WHERE email = 'admin@gmail.com'");
    if (existAdmin.length === 0 && aId) {
      await c.query(
        "INSERT INTO user (fullName, email, password, roleId) VALUES (?, ?, ?, ?)",
        ['Admin', 'admin@gmail.com', hash, aId]
      );
    }

    console.log("✅ Credentials updated successfully!");
    await c.end();
  } catch (err) {
    console.error("Error updating credentials:", err);
  }
}

main();
