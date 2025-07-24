// src/app/admin/dashboard/page.tsx
import { auth, signOut } from '@/lib/auth'; // Ensure correct import
import { redirect } from 'next/navigation';

export default async function AdminDashboardPage() {
  const session = await auth();

  // This check is redundant if middleware is set up correctly, but good for safety
  if (!session) {
    redirect('/admin/login');
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white p-6 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold mb-6">Welcome to the Admin Dashboard, {session?.user?.name || session?.user?.email}!</h1>
        <p className="mb-4">Your role: <span className="font-semibold">{session?.user?.role}</span></p>

        <h2 className="text-2xl font-semibold mb-4">Content Management</h2>
        <ul className="list-disc pl-5 mb-6">
          <li><a href="/admin/articles" className="text-blue-600 hover:underline">Manage Articles</a></li>
          <li><a href="/admin/deals" className="text-blue-600 hover:underline">Manage Featured Deals</a></li>
        </ul>

        <form action={async () => {
          'use server';
          await signOut();
        }}>
          <button
            type="submit"
            className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );
}