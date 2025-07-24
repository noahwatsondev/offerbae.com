// src/components/FilterSidebar.tsx
'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { sendGAEvent } from '@next/third-parties/google';

type FilterSidebarProps = {
  currentQuery?: string;
  currentCategory?: string;
  currentBrand?: string;
  currentMerchant?: string;
  categories: string[];
  brands: string[];
  merchants: string[];
};

export default function FilterSidebar({
  currentQuery = '',
  currentCategory = '',
  currentBrand = '',
  currentMerchant = '',
  categories,
  brands,
  merchants,
}: FilterSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedCategory, setSelectedCategory] = useState(currentCategory);
  const [selectedBrand, setSelectedBrand] = useState(currentBrand);
  const [selectedMerchant, setSelectedMerchant] = useState(currentMerchant);
  // Add states for other filters (e.g., price range, discount)

  // Update internal states when props (URL params) change
  useEffect(() => {
    setSelectedCategory(currentCategory);
    setSelectedBrand(currentBrand);
    setSelectedMerchant(currentMerchant);
  }, [currentCategory, currentBrand, currentMerchant]);

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      // Always keep the 'q' parameter if it exists and we're on the search page
      if (pathname === '/search' && currentQuery) {
         params.set('q', currentQuery);
      } else if (pathname === '/search' && !currentQuery) {
         params.delete('q'); // Clear if no query
      }
      return params.toString();
    },
    [searchParams, pathname, currentQuery]
  );

  const applyFilters = (filterType: string, value: string) => {
    sendGAEvent({
      event: 'filter_used',
      params: {
        filter_type: filterType,
        filter_value: value,
        search_query: currentQuery,
      },
    });
    const queryString = createQueryString(filterType, value);
    router.push(`${pathname}?${queryString}`);
  };

  const handleClearFilters = () => {
    sendGAEvent({
      event: 'filter_cleared',
      params: { search_query: currentQuery },
    });
    // If on search page, clear filters but keep the search query
    if (pathname === '/search') {
      router.push(`/search?q=${encodeURIComponent(currentQuery)}`);
    } else { // If on category page, clear filters and go back to category root
      router.push(pathname);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md sticky top-4 self-start border border-gray-200">
      <h2 className="text-xl font-bold mb-5 text-gray-800">Filter Results</h2>

      <div className="mb-6">
        <label htmlFor="category-filter" className="block text-gray-700 text-sm font-semibold mb-2">Category</label>
        <select
          id="category-filter"
          value={selectedCategory}
          onChange={(e) => {
            setSelectedCategory(e.target.value);
            applyFilters('category', e.target.value);
          }}
          className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Categories</option>
          {categories.sort().map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div className="mb-6">
        <label htmlFor="brand-filter" className="block text-gray-700 text-sm font-semibold mb-2">Brand</label>
        <select
          id="brand-filter"
          value={selectedBrand}
          onChange={(e) => {
            setSelectedBrand(e.target.value);
            applyFilters('brand', e.target.value);
          }}
          className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Brands</option>
          {brands.sort().map((brand) => (
            <option key={brand} value={brand}>{brand}</option>
          ))}
        </select>
      </div>

      <div className="mb-6">
        <label htmlFor="merchant-filter" className="block text-gray-700 text-sm font-semibold mb-2">Merchant</label>
        <select
          id="merchant-filter"
          value={selectedMerchant}
          onChange={(e) => {
            setSelectedMerchant(e.target.value);
            applyFilters('merchant', e.target.value);
          }}
          className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Merchants</option>
          {merchants.sort().map((merchant) => (
            <option key={merchant} value={merchant}>{merchant}</option>
          ))}
        </select>
      </div>

      {/* Add more filter sections here (e.g., Price Range, Discount Percentage) */}

      {(selectedCategory || selectedBrand || selectedMerchant) && (
        <button
          onClick={handleClearFilters}
          className="w-full bg-gray-200 text-gray-800 py-3 rounded-lg hover:bg-gray-300 transition-colors duration-200 font-semibold focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
        >
          Clear All Filters
        </button>
      )}
    </div>
  );
}