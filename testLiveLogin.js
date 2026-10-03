import axios from 'axios';

async function testLiveLogin(email, password) {
  try {
    const res = await axios.post('https://api.gym-newss.kiaantechnology.com/api/auth/login', {
      email,
      password
    });
    console.log(`[SUCCESS] ${email}:`, res.data.user?.email, "Role:", res.data.user?.roleName);
  } catch (err) {
    console.log(`[FAILED] ${email}:`, err.response?.data?.message || err.message);
  }
}

async function run() {
  await testLiveLogin('superadmin@gmail.com', '123456');
  await testLiveLogin('superadmin@gmail.com', 'admin');
  await testLiveLogin('test@test.com', '123456');
}
run();
