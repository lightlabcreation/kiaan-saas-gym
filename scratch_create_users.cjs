const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // Ensure roles exist
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'Super Admin' },
    update: {},
    create: { name: 'Super Admin' }
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    create: { name: 'Admin' }
  });

  const hash = await bcrypt.hash('123456', 10);

  // Super Admin
  await prisma.user.upsert({
    where: { email: 'superadmin@gmail.com' },
    update: { password: hash, roleId: superAdminRole.id },
    create: {
      fullName: 'Super Admin',
      email: 'superadmin@gmail.com',
      password: hash,
      roleId: superAdminRole.id
    }
  });

  // Admin
  await prisma.user.upsert({
    where: { email: 'admin@gmail.com' },
    update: { password: hash, roleId: adminRole.id },
    create: {
      fullName: 'Admin',
      email: 'admin@gmail.com',
      password: hash,
      roleId: adminRole.id
    }
  });

  console.log('Users created successfully');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
