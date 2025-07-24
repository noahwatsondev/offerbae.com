// src/app/api/admin/users/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth'; // NextAuth's auth function
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  const session = await auth(); // Get the current session
  if (!session || session.user?.role !== 'admin') { // Check if user is logged in AND has 'admin' role
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { name, email, password, role } = await req.json();

  if (!email || !password || !name || !role) {
    return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
      },
    });
    return NextResponse.json(newUser, { status: 201 });
  } catch (error: any) {
    if (error.code === 'P2002') { // Prisma unique constraint violation (e.g., email already exists)
      return NextResponse.json({ message: 'User with this email already exists' }, { status: 409 });
    }
    console.error('Error creating user:', error);
    return NextResponse.json({ message: 'Failed to create user' }, { status: 500 });
  }
}