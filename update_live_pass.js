import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

async function updateLivePassword() {
  try {
    const connection = await mysql.createConnection({
      host: "altaria.proxy.rlwy.net",
      user: "root",
      password: "uplmTsXTNmcVAXsJNwCqLNsZqiEjLcZa",
      database: "railway",
      port: 39145,
      ssl: { rejectUnauthorized: false },
      connectTimeout: 20000
    });
    console.log("Connected to Railway Live Database!");
    const hash = await bcrypt.hash('123456', 10);
    const [res] = await connection.query(
      "UPDATE user SET password = ?, status = 'Active', visiblePassword = '123456' WHERE email = 'superadmin@gmail.com' OR roleId = 1",
      [hash]
    );
    console.log("Live DB Update Result:", res);
    await connection.end();
  } catch (err) {
    console.error("Live DB Error:", err.message);
  }
}
updateLivePassword();
