// next-auth.d.ts
import 'next-auth';
import { DefaultSession } from 'next-auth'; // Import DefaultSession

declare module 'next-auth' {
  interface Session {
    user: {
      id: string; // Add id
      role: string; // Add role (e.g., "admin", "editor")
    } & DefaultSession['user']; // Extend default user properties
  }

  interface JWT {
    id: string; // Add id
    role: string; // Add role
  }
}