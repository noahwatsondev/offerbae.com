// src/app/api/products/route.ts (Example of API Route using cache)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

const CACHE_KEY_TOP_PRODUCTS = 'top_products';
const CACHE_TTL_SECONDS = 3600; // 1 hour

export async function GET() {
  try {
    // 1. Try to fetch from cache
    const cachedProducts = await redis.get(CACHE_KEY_TOP_PRODUCTS);
    if (cachedProducts) {
      console.log('Serving top products from Redis cache.');
      return NextResponse.json(cachedProducts);
    }

    // 2. If not in cache, fetch from database
    console.log('Fetching top products from database...');
    const products = await prisma.product.findMany({
      take: 20,
      orderBy: { lastFetchedAt: 'desc' }, // Example ordering
      include: { advertiser: true },
    });

    // 3. Store in cache for future requests
    await redis.setex(CACHE_KEY_TOP_PRODUCTS, CACHE_TTL_SECONDS, JSON.stringify(products));
    console.log('Stored top products in Redis cache.');

    return NextResponse.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

// In your ingestion function (src/app/api/ingest-data/route.ts),
// after successfully upserting data, you should invalidate relevant caches:
/*
  // ... after prisma.$transaction for products
  await redis.del(CACHE_KEY_TOP_PRODUCTS); // Invalidate cache for top products
  // Also invalidate specific category caches if you implement them
*/