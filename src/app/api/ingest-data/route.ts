// src/app/api/ingest-data/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchRakutenProducts, fetchCjProducts } from '@/utils/affiliateApis';
import slugify from 'slugify'; // npm install slugify

// Environment variables for API keys
const RAKUTEN_TOKEN = process.env.RAKUTEN_TOKEN || '';
const RAKUTEN_FEED_URL = process.env.RAKUTEN_FEED_URL || '';
const CJ_DEVELOPER_KEY = process.env.CJ_DEVELOPER_KEY || '';
const CJ_WEBSITE_ID = process.env.CJ_WEBSITE_ID || ''; // CJ website ID

export async function GET() { // Using GET for demonstration, POST/PUT for production triggered via cron
  if (!RAKUTEN_TOKEN || !RAKUTEN_FEED_URL || !CJ_DEVELOPER_KEY || !CJ_WEBSITE_ID) {
    console.error("Missing affiliate API credentials in environment variables.");
    return NextResponse.json({ error: 'Missing API credentials' }, { status: 500 });
  }

  let ingestedProductsCount = 0;
  let ingestedCouponsCount = 0;

  try {
    // --- Rakuten Ingestion ---
    console.log("Starting Rakuten ingestion...");
    const rakutenRawProducts = await fetchRakutenProducts(RAKUTEN_TOKEN, RAKUTEN_FEED_URL);

    let rakutenAdvertiser = await prisma.advertiser.upsert({
      where: { name: 'Rakuten Advertising' },
      update: {},
      create: { name: 'Rakuten Advertising' },
    });

    const rakutenProductsToUpsert = rakutenRawProducts.map(p => ({
      affiliateProductId: p.affiliateProductId,
      name: p.name,
      slug: slugify(p.name, { lower: true, strict: true, trim: true }),
      description: p.description,
      price: p.price,
      currency: p.currency,
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      affiliateLink: p.affiliateLink,
      category: p.category,
      merchantName: p.merchantName,
      brand: p.brand,
      originalPrice: p.originalPrice,
      discountPercentage: p.discountPercentage,
      availability: p.availability,
      advertiserId: rakutenAdvertiser.id,
      lastFetchedAt: new Date(),
      searchContent: `${p.name} ${p.description || ''} ${p.category || ''} ${p.brand || ''} ${p.merchantName || ''}`,
    }));

    await prisma.$transaction(
      rakutenProductsToUpsert.map(data =>
        prisma.product.upsert({
          where: { affiliateProductId: data.affiliateProductId },
          update: data,
          create: data,
        })
      )
    );
    ingestedProductsCount += rakutenProductsToUpsert.length;
    console.log(`Finished Rakuten ingestion. Upserted ${rakutenProductsToUpsert.length} products.`);

    // --- Commission Junction Ingestion ---
    console.log("Starting CJ ingestion...");
    const cjRawProducts = await fetchCjProducts(CJ_DEVELOPER_KEY, CJ_WEBSITE_ID);

    let cjAdvertiser = await prisma.advertiser.upsert({
      where: { name: 'CJ Affiliate' },
      update: {},
      create: { name: 'CJ Affiliate' },
    });

    // You'd also fetch coupon codes from CJ here if applicable
    // Example: fetchCjCoupons(...) -> map to CouponCode model

    const cjProductsToUpsert = cjRawProducts.map(p => ({
      affiliateProductId: p.affiliateProductId,
      name: p.name,
      slug: slugify(p.name, { lower: true, strict: true, trim: true }),
      description: p.description,
      price: p.price,
      currency: p.currency || 'USD',
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      affiliateLink: p.affiliateLink,
      category: p.category,
      merchantName: p.merchantName,
      brand: p.brand,
      advertiserId: cjAdvertiser.id,
      lastFetchedAt: new Date(),
      searchContent: `${p.name} ${p.description || ''} ${p.category || ''} ${p.brand || ''} ${p.merchantName || ''}`,
    }));

    await prisma.$transaction(
      cjProductsToUpsert.map(data =>
        prisma.product.upsert({
          where: { affiliateProductId: data.affiliateProductId },
          update: data,
          create: data,
        })
      )
    );
    ingestedProductsCount += cjProductsToUpsert.length;
    console.log(`Finished CJ ingestion. Upserted ${cjProductsToUpsert.length} products.`);

    // --- Ingest Coupon Codes (Example for a generic coupon fetch, integrate with CJ/Rakuten APIs) ---
    // You would integrate calls to fetch actual coupon data from Rakuten/CJ here
    // For now, a placeholder to demonstrate CouponCode upsert
    const genericCoupons = [
      {
        code: 'SUMMER20',
        discount: '20% off',
        merchantName: 'Example Store',
        affiliateLink: 'https://example.com/track/summer20',
        expirationDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // 1 year from now
        advertiserId: rakutenAdvertiser.id, // Or cjAdvertiser.id
      },
    ];

    await prisma.$transaction(
      genericCoupons.map(couponData =>
        prisma.couponCode.upsert({
          where: { code_merchantName: { code: couponData.code, merchantName: couponData.merchantName } },
          update: couponData,
          create: couponData,
        })
      )
    );
    ingestedCouponsCount += genericCoupons.length;
    console.log(`Ingested ${ingestedCouponsCount} coupon codes.`);

    return NextResponse.json({
      message: 'Data ingestion successful',
      productsIngested: ingestedProductsCount,
      couponsIngested: ingestedCouponsCount,
    });
  } catch (error) {
    console.error('Data ingestion failed:', error);
    return NextResponse.json({ error: 'Data ingestion failed' }, { status: 500 });
  }
}