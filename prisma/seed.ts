// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('yoursecureadminpassword', 10); // CHANGE THIS PASSWORD!

  await prisma.user.upsert({
    where: { email: 'admin@offerbae.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@offerbae.com',
      password: hashedPassword,
      role: 'admin',
    },
  });

  console.log('Admin user seeded.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });