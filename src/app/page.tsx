// src/app/page.tsx
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import Image from 'next/image';
import Link from 'next/link';
import ProductCard from '@/components/ProductCard';
import SearchInput from '@/components/SearchInput';
import Header from '@/components/Header'; // Create this component
import Footer from '@/components/Footer'; // Create this component
import { Suspense } from 'react'; // For loading state for dynamic components

const CACHE_KEY_FEATURED_PRODUCTS = 'featured_products_homepage';
const CACHE_KEY_TOP_CATEGORIES = 'top_categories_homepage';
const CACHE_TTL_SECONDS = 3600; // 1 hour

export default async function HomePage() {
  let featuredProducts = [];
  let categories = [];

  try {
    // Fetch featured products
    const cachedProducts = await redis.get(CACHE_KEY_FEATURED_PRODUCTS);
    if (cachedProducts) {
      featuredProducts = JSON.parse(cachedProducts);
    } else {
      featuredProducts = await prisma.product.findMany({
        take: 12, // Fetch a few featured products
        orderBy: { lastFetchedAt: 'desc' },
        where: { imageUrl: { not: null, not: '' } }, // Ensure products have images
        include: { advertiser: true },
      });
      await redis.setex(CACHE_KEY_FEATURED_PRODUCTS, CACHE_TTL_SECONDS, JSON.stringify(featuredProducts));
    }

    // Fetch top categories
    const cachedCategories = await redis.get(CACHE_KEY_TOP_CATEGORIES);
    if (cachedCategories) {
      categories = JSON.parse(cachedCategories);
    } else {
      const rawCategories = await prisma.product.findMany({
        select: { category: true },
        distinct: ['category'],
        where: { category: { not: null, not: '' } },
        take: 8 // Limit to top 8 categories for display
      });
      categories = rawCategories.map(c => c.category);
      await redis.setex(CACHE_KEY_TOP_CATEGORIES, CACHE_TTL_SECONDS, JSON.stringify(categories));
    }

  } catch (error) {
    console.error("Error fetching homepage data:", error);
    // Fallback to direct DB query or empty array if cache fails
    featuredProducts = await prisma.product.findMany({
      take: 12,
      orderBy: { lastFetchedAt: 'desc' },
      where: { imageUrl: { not: null, not: '' } },
      include: { advertiser: true },
    });
    categories = (await prisma.product.findMany({
      select: { category: true },
      distinct: ['category'],
      where: { category: { not: null, not: '' } },
      take: 8
    })).map(c => c.category);
  }

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <section className="text-center mb-16 bg-gradient-to-r from-blue-500 to-purple-600 text-white py-16 rounded-xl shadow-lg">
          <h1 className="text-4xl md:text-6xl font-extrabold mb-4 animate-fade-in-up">
            Unlock Amazing Deals & Discounts!
          </h1>
          <p className="text-lg md:text-xl mb-8 opacity-90 animate-fade-in-up delay-100">
            Your ultimate source for verified coupon codes, product reviews, and unbeatable savings.
          </p>
          <div className="flex justify-center animate-fade-in-up delay-200">
            <SearchInput />
          </div>
        </section>

        {/* Top Categories Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-800 mb-8 text-center">Explore Top Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {categories.map((cat, index) => (
              cat && (
                <Link key={index} href={`/${slugify(cat, { lower: true, strict: true })}`} className="block p-6 bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-200 text-center text-lg font-semibold text-blue-700 hover:text-blue-900 border border-gray-100">
                  {cat}
                </Link>
              )
            ))}
          </div>
        </section>

        {/* Featured Offers Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-800 mb-8 text-center">Featured Offers & Trending Deals</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {featuredProducts.length > 0 ? (
              featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))
            ) : (
              <p className="col-span-full text-center text-gray-600">No featured products available at the moment.</p>
            )}
          </div>
        </section>

        {/* Latest Articles/Guides Section (Optional) */}
        {/* <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-800 mb-8 text-center">Latest Guides & Reviews</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/ * Fetch and render ArticleCard components here * /}
          </div>
        </section> */}
      </main>
      <Footer />
    </>
  );
}