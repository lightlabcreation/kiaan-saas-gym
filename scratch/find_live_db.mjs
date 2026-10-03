import mysql from 'mysql2/promise';

async function test(name, opts) {
  try {
    const conn = await mysql.createConnection({ ...opts, connectTimeout: 10000 });
    const [rows] = await conn.query('SELECT COUNT(*) as count FROM user');
    console.log(`✅ [${name}] SUCCESS: User count = ${rows[0].count}`);
    const [superAdmins] = await conn.query("SELECT id, email, roleId, status, visiblePassword FROM user WHERE roleId = 1 OR email LIKE '%superadmin%'");
    console.log("SuperAdmins in DB:", superAdmins);
    await conn.end();
    return true;
  } catch (err) {
    console.log(`❌ [${name}] FAIL: ${err.message}`);
    return false;
  }
}

(async () => {
  console.log("Testing live database connections...");
  await test("Altaria 39145", {
    host: "altaria.proxy.rlwy.net",
    user: "root",
    password: "uplmTsXTNmcVAXsJNwCqLNsZqiEjLcZa",
    database: "railway",
    port: 39145,
    ssl: { rejectUnauthorized: false }
  });
  await test("Tokaido 55340", {
    host: "tokaido.proxy.rlwy.net",
    user: "root",
    password: "BVqUcROWCIrVnzhGaSayAJkaetgPkYGJ",
    database: "railway",
    port: 55340,
    ssl: { rejectUnauthorized: false }
  });
})();
