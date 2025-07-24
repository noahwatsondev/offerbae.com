// src/app/search/page.tsx
import { prisma } from '@/lib/prisma';
import ProductCard from '@/components/ProductCard';
import SearchInput from '@/components/SearchInput';
import FilterSidebar from '@/components/FilterSidebar'; // New component for filters
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Suspense } from 'react';

export default async function SearchResultsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const searchQuery = searchParams.q as string || '';
  const categoryFilter = searchParams.category as string || '';
  const brandFilter = searchParams.brand as string || '';
  const merchantFilter = searchParams.merchant as string || '';
  // Add more filters as needed

  const products = await prisma.product.findMany({
    where: {
      AND: [
        searchQuery
          ? {
              OR: [
                { name: { contains: searchQuery, mode: 'insensitive' } },
                { description: { contains: searchQuery, mode: 'insensitive' } },
                { category: { contains: searchQuery, mode: 'insensitive' } },
                { brand: { contains: searchQuery, mode: 'insensitive' } },
                { merchantName: { contains: searchQuery, mode: 'insensitive' } },
                { searchContent: { contains: searchQuery, mode: 'insensitive' } }
              ],
            }
          : {},
        categoryFilter ? { category: { equals: categoryFilter, mode: 'insensitive' } } : {},
        brandFilter ? { brand: { equals: brandFilter, mode: 'insensitive' } } : {},
        merchantFilter ? { merchantName: { equals: merchantFilter, mode: 'insensitive' } } : {},
      ],
    },
    orderBy: { lastFetchedAt: 'desc' },
    take: 50,
    include: { advertiser: true },
  });

  const availableFilters = {
    categories: (await prisma.product.findMany({ select: { category: true }, distinct: ['category'], where: { category: { not: null, not: '' } } }))
                  .map(c => c.category!).filter(Boolean) as string[],
    brands: (await prisma.product.findMany({ select: { brand: true }, distinct: ['brand'], where: { brand: { not: null, not: '' } } }))
                  .map(b => b.brand!).filter(Boolean) as string[],
    merchants: (await prisma.product.findMany({ select: { merchantName: true }, distinct: ['merchantName'], where: { merchantName: { not: null, not: '' } } }))
                  .map(m => m.merchantName!).filter(Boolean) as string[],
  };


  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-6 text-gray-900">
          Search Results {searchQuery && `for "${searchQuery}"`}
        </h1>
        <div className="mb-8">
          <SearchInput />
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Filters Sidebar - Client Component */}
          <div className="w-full md:w-1/4">
            <Suspense fallback={<div className="bg-white p-6 rounded-lg shadow-md animate-pulse h-64">Loading filters...</div>}>
              <FilterSidebar
                currentQuery={searchQuery}
                currentCategory={categoryFilter}
                currentBrand={brandFilter}
                currentMerchant={merchantFilter}
                categories={availableFilters.categories}
                brands={availableFilters.brands}
                merchants={availableFilters.merchants}
              />
            </Suspense>
          </div>

          {/* Product Listing */}
          <div className="w-full md:w-3/4">
            {products.length === 0 ? (
              <p className="text-lg text-gray-600 text-center py-12 bg-white rounded-lg shadow-md">No products found for your search criteria.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}