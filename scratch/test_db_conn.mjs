import mysql from 'mysql2/promise';

async function testConn(name, config) {
  try {
    const conn = await mysql.createConnection(config);
    const [rows] = await conn.query('SELECT COUNT(*) as count FROM user');
    console.log(`✅ ${name} SUCCESS: User count = ${rows[0].count}`);
    await conn.end();
  } catch (err) {
    console.error(`❌ ${name} ERROR: ${err.message}`);
  }
}

(async () => {
  await testConn('Altaria', {
    host: 'altaria.proxy.rlwy.net',
    user: 'root',
    password: 'uplmTsXTNmcVAXsJNwCqLNsZqiEjLcZa',
    database: 'railway',
    port: 39145,
    ssl: { rejectUnauthorized: false }
  });
  await testConn('Tokaido', {
    host: 'tokaido.proxy.rlwy.net',
    user: 'root',
    password: 'BVqUcROWCIrVnzhGaSayAJkaetgPkYGJ',
    database: 'railway',
    port: 55340,
    ssl: { rejectUnauthorized: false }
  });
})();
