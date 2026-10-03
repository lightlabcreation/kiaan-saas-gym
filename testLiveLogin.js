import axios from 'axios';

const accounts = [
  { email: 'superadmin@gmail.com', pass: '123456' },
  { email: 'superadmin@gmail.com', pass: 'admin' },
  { email: 'superadmin@gmail.com', pass: 'superadmin' },
  { email: 'test@test.com', pass: '123456' },
  { email: 'admin@gmail.com', pass: '123456' },
  { email: 'john@gmail.com', pass: '123456' },
  { email: 'piasubadmin@gmail.com', pass: '123456' },
  { email: 'receptionist3@gmail.com', pass: '123456' },
  { email: 'personal3@gmail.com', pass: '123456' },
  { email: 'general1@gmail.com', pass: '123456' },
  { email: 'sneha@gmail.com', pass: '123456' },
  { email: 'john.doe@example.com', pass: '123456' },
  { email: 'housekeeping3@gmail.com', pass: '123456' }
];

async function testLiveLogin(email, password) {
  try {
    const res = await axios.post('https://api.gym-newss.kiaantechnology.com/api/auth/login', {
      email,
      password
    });
    console.log(`✅ [SUCCESS] ${email} (pass: ${password}): ID=${res.data.user?.id}, Role=${res.data.user?.roleName}`);
    return true;
  } catch (err) {
    console.log(`❌ [FAILED] ${email} (pass: ${password}):`, err.response?.data?.message || err.message);
    return false;
  }
}

async function run() {
  console.log("Testing live login for all requested accounts...");
  for (const acc of accounts) {
    await testLiveLogin(acc.email, acc.pass);
  }
}
run();
