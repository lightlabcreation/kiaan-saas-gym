import axios from 'axios';

async function test(email, pass) {
  try {
    const res = await axios.post('https://api.gym-newss.kiaantechnology.com/api/auth/login', { email, password: pass });
    console.log(`✅ [SUPERADMIN/ADMIN SUCCESS] ${email}: ID=${res.data.user?.id}, Role=${res.data.user?.roleName}`);
  } catch (err) {
    console.log(`❌ [FAILED] ${email}:`, err.response?.data?.message || err.message);
  }
}

async function run() {
  await test('superadmin@gmail.com', '123456');
  await test('admin@gmail.com', '123456');
  await test('test@test.com', '123456');
}
run();
