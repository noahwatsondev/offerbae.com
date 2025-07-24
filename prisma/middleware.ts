// middleware.ts
import { NextResponse } from 'next/server';
import { auth } from './src/lib/auth'; // Adjust path if needed

export default auth((req) => {
  const { nextUrl } = req;
  const isAuthenticated = !!req.auth; // Check if user is authenticated

  // Protect /admin routes
  const isAdminRoute = nextUrl.pathname.startsWith('/admin');

  if (isAdminRoute && !isAuthenticated) {
    // Redirect unauthenticated users trying to access admin routes to login page
    return NextResponse.redirect(new URL('/admin/login', nextUrl));
  }

  // Allow authenticated users to proceed
  return NextResponse.next();
});

export const config = {
  matcher: ['/admin/:path*'], // Apply middleware to all routes under /admin
};