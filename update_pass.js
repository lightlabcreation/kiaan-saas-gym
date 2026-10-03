import bcrypt from 'bcryptjs';
import { pool } from './src/config/db.js';

async function updatePasswords() {
  try { 
    const hash = await bcrypt.hash('123456', 10); 
    await pool.query(
      "UPDATE user SET password = ?, status = 'Active', visiblePassword = '123456' WHERE email = 'superadmin@gmail.com' OR roleId = 1", 
      [hash]
    ); 
    console.log('Successfully reset password to 123456 for superadmin@gmail.com and all superadmin accounts!'); 
  } catch (e) { 
    console.error('DB ERROR:', e); 
  } 
  process.exit(0);
}
updatePasswords();

