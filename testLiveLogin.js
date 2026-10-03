import axios from 'axios';

const list = [
  'john@gmail.com',
  'piasubadmin@gmail.com',
  'generaltrainer1@gym.com',
  'general1@gmail.com',
  'sneha@gmail.com',
  'salesagent@gmail.com',
  'receptionist@gmail.com',
  'personal@gmail.com',
  'housekeeping@gmail.com'
];

async function test(email) {
  try {
    const res = await axios.post('https://api.gym-newss.kiaantechnology.com/api/auth/login', { email, password: '123456' });
    console.log(`✅ SUCCESS -> Email: ${email} | Role: ${res.data.user?.roleName} | ID: ${res.data.user?.id}`);
  } catch (err) {
    console.log(`❌ FAILED -> Email: ${email} | Error: ${err.response?.data?.message || err.message}`);
  }
}

async function run() {
  for (const email of list) {
    await test(email);
  }
}
run();
