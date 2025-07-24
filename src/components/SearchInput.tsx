// src/components/SearchInput.tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { sendGAEvent } from '@next/third-parties/google';

export default function SearchInput() {
  const [query, setQuery] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      sendGAEvent({
        event: 'search',
        params: { search_term: query.trim() }
      });
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <form onSubmit={handleSearch} className="flex items-center w-full max-w-2xl mx-auto border-2 border-blue-400 rounded-full overflow-hidden shadow-md focus-within:ring-4 focus-within:ring-blue-300 transition-all duration-200">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search for laptops, electronics, apparel..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="flex-grow p-3 md:p-4 text-lg border-none focus:outline-none focus:ring-0 rounded-l-full bg-white text-gray-800 placeholder-gray-400"
      />
      <button
        type="submit"
        className="bg-blue-600 text-white p-3 md:p-4 rounded-r-full hover:bg-blue-700 focus:outline-none focus:ring-0 transition-colors duration-200 flex items-center justify-center"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="hidden md:inline ml-2">Search</span>
      </button>
    </form>
  );
}