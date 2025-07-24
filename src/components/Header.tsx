// src/components/Header.tsx
'use client';
import Link from 'next/link';
import SearchInput from './SearchInput'; // Re-use the search input
import { useSession } from 'next-auth/react'; // For checking session

export default function Header() {
  const { data: session } = useSession();

  return (
    <header className="bg-white shadow-md sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <Link href="/" className="text-3xl font-extrabold text-blue-600 hover:text-blue-700 transition-colors duration-200">
          OfferBae
        </Link>
        <div className="w-full md:w-1/2 lg:w-1/3">
          <SearchInput />
        </div>
        <nav className="flex items-center space-x-6 text-lg font-medium">
          <Link href="/coupons" className="text-gray-700 hover:text-blue-600 transition-colors duration-200">
            Coupons
          </Link>
          <Link href="/categories" className="text-gray-700 hover:text-blue-600 transition-colors duration-200">
            Categories
          </Link>
          {session?.user?.role === 'admin' || session?.user?.role === 'editor' ? (
            <Link href="/admin/dashboard" className="text-purple-700 hover:text-purple-800 transition-colors duration-200">
              Admin
            </Link>
          ) : (
            <Link href="/admin/login" className="text-gray-700 hover:text-blue-600 transition-colors duration-200">
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}