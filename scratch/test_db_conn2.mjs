import mysql from 'mysql2/promise';

async function test(opts) {
  try {
    const conn = await mysql.createConnection(opts);
    const [rows] = await conn.query('SELECT COUNT(*) as count FROM user');
    console.log(`✅ SUCCESS (${opts.host}:${opts.port}) count: ${rows[0].count}`);
    await conn.end();
    return true;
  } catch (err) {
    console.log(`❌ FAIL (${opts.host}:${opts.port}): ${err.message}`);
    return false;
  }
}

(async () => {
  console.log("Testing Railway connections...");
  await test({
    host: 'altaria.proxy.rlwy.net',
    user: 'root',
    password: 'uplmTsXTNmcVAXsJNwCqLNsZqiEjLcZa',
    database: 'railway',
    port: 39145,
    ssl: false
  });
  await test({
    host: 'tokaido.proxy.rlwy.net',
    user: 'root',
    password: 'BVqUcROWCIrVnzhGaSayAJkaetgPkYGJ',
    database: 'railway',
    port: 55340,
    ssl: false
  });
})();
