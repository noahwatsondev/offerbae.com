// src/types/next-auth.d.ts
import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "@auth/core/jwt";

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: {
      id: string; // Add id to user
      role: string; // Add role to user
    } & DefaultSession["user"];
  }

  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface User extends DefaultUser {
    role: string; // Add role to User object
  }
}

declare module "@auth/core/jwt" {
  interface JWT extends DefaultJWT {
    role: string; // Add role to JWT
  }
}