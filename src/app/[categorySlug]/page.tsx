// src/app/[categorySlug]/page.tsx
import { prisma } from '@/lib/prisma';
import ProductCard from '@/components/ProductCard';
import FilterSidebar from '@/components/FilterSidebar'; // Re-use the filter sidebar
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import slugify from 'slugify';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

// Generate static paths for pre-rendering known categories
export async function generateStaticParams() {
  const categories = await prisma.product.findMany({
    select: { category: true },
    distinct: ['category'],
    where: { category: { not: null, not: '' } }
  });

  return categories.map((c) => ({
    categorySlug: slugify(c.category!, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g }),
  }));
}

// Set revalidation time for ISR
export const revalidate = 3600; // Revalidate at most every hour

export default async function CategoryPage({
  params,
  searchParams, // Added to pass to FilterSidebar
}: {
  params: { categorySlug: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const displayCategorySlug = params.categorySlug;
  const categoryFilter = searchParams.category as string || ''; // For filter sidebar
  const brandFilter = searchParams.brand as string || '';
  const merchantFilter = searchParams.merchant as string || '';


  const categoryMapping = await prisma.product.findFirst({
    where: {
      slug: displayCategorySlug, // Try to find by direct slug
      category: { not: null, not: '' }
    },
    select: { category: true }
  });

  // Fallback: If slug doesn't match a direct product slug, try to reverse slugify to find category name
  let actualCategoryName: string | null = null;
  if (categoryMapping) {
    actualCategoryName = categoryMapping.category;
  } else {
    // Attempt to reverse slugify and find a category that matches
    const reversedSlug = displayCategorySlug.replace(/-/g, ' ');
    const matchingCategory = await prisma.product.findFirst({
      where: { category: { equals: reversedSlug, mode: 'insensitive' } },
      select: { category: true }
    });
    if (matchingCategory) {
      actualCategoryName = matchingCategory.category;
    }
  }

  if (!actualCategoryName) {
    notFound(); // If no matching category found, show 404
  }

  const products = await prisma.product.findMany({
    where: {
      category: {
        equals: actualCategoryName,
        mode: 'insensitive',
      },
      imageUrl: { not: null, not: '' },
      // Apply additional filters from searchParams
      AND: [
         brandFilter ? { brand: { equals: brandFilter, mode: 'insensitive' } } : {},
         merchantFilter ? { merchantName: { equals: merchantFilter, mode: 'insensitive' } } : {},
      ]
    },
    orderBy: { lastFetchedAt: 'desc' },
    take: 50,
    include: { advertiser: true },
  });

  const availableFilters = {
    categories: (await prisma.product.findMany({ select: { category: true }, distinct: ['category'], where: { category: { not: null, not: '' } } }))
                  .map(c => c.category!).filter(Boolean) as string[],
    brands: (await prisma.product.findMany({ select: { brand: true }, distinct: ['brand'], where: { category: { equals: actualCategoryName, mode: 'insensitive' }, brand: { not: null, not: '' } } }))
                  .map(b => b.brand!).filter(Boolean) as string[],
    merchants: (await prisma.product.findMany({ select: { merchantName: true }, distinct: ['merchantName'], where: { category: { equals: actualCategoryName, mode: 'insensitive' }, merchantName: { not: null, not: '' } } }))
                  .map(m => m.merchantName!).filter(Boolean) as string[],
  };

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-6 capitalize text-gray-900">
          {actualCategoryName} Deals & Offers
        </h1>
        <p className="text-lg text-gray-700 mb-8">
          Explore the latest discounts and exclusive offers on a wide range of {actualCategoryName.toLowerCase()} products from top brands and merchants.
        </p>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Filters Sidebar */}
          <div className="w-full md:w-1/4">
            <Suspense fallback={<div className="bg-white p-6 rounded-lg shadow-md animate-pulse h-64">Loading filters...</div>}>
              <FilterSidebar
                currentQuery="" // No general query on category pages
                currentCategory={actualCategoryName} // Pre-set the category filter
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
              <p className="text-lg text-gray-600 text-center py-12 bg-white rounded-lg shadow-md">No deals found in {actualCategoryName} at the moment with current filters.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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