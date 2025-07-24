// src/lib/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma"; // Your Prisma client singleton
import bcrypt from "bcryptjs";

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  adapter: PrismaAdapter(prisma), // Connects NextAuth.js to Prisma
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email) },
        });

        if (!user || !user.password) {
          return null; // User not found or no password set
        }

        const isPasswordValid = await bcrypt.compare(
          String(credentials.password),
          user.password
        );

        if (!isPasswordValid) {
          return null; // Invalid password
        }

        // Return user object, NextAuth.js will store relevant info
        // Ensure the user object contains `id` and `role` as per your `next-auth.d.ts`
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role, // Include the role here
        };
      },
    }),
  ],
  session: {
    strategy: "jwt", // Use JWT for session management
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id; // Add user id to JWT
        token.role = user.role; // Add role to JWT
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string; // Ensure id is propagated to session
        session.user.role = token.role as string; // Ensure role is propagated to session
      }
      return session;
    },
  },
  pages: {
    signIn: "/admin/login", // Custom login page path
  },
  secret: process.env.NEXTAUTH_SECRET, // Make sure this is set in .env
});