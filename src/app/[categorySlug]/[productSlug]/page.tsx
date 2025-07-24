// src/app/[categorySlug]/[productSlug]/page.tsx
import { prisma } from '@/lib/prisma';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import slugify from 'slugify';
import ProductCard from '@/components/ProductCard'; // For related products
import ClientSideAffiliateButton from '@/components/ClientSideAffiliateButton'; // Client component to track clicks
import ClientSideCouponButton from '@/components/ClientSideCouponButton'; // Re-use for linked coupons
import Header from '@/components/Header';
import Footer from '@/components/Footer';

// Generate static paths for pre-rendering known products
export async function generateStaticParams() {
  const products = await prisma.product.findMany({
    select: { category: true, slug: true },
    where: { category: { not: null, not: '' }, slug: { not: null, not: '' } },
    take: 1000 // Limit for build time. For larger sites, consider a more dynamic approach or external tools.
  });

  return products.map((product) => ({
    categorySlug: slugify(product.category!, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g }),
    productSlug: product.slug!,
  }));
}

export const revalidate = 3600; // Revalidate at most every hour

export default async function ProductDetailPage({
  params,
}: {
  params: { categorySlug: string; productSlug: string };
}) {
  const product = await prisma.product.findUnique({
    where: { slug: params.productSlug },
    include: { advertiser: true, couponCode: true },
  });

  if (!product) {
    notFound();
  }

  // Fetch related products (e.g., from the same merchant or category)
  const relatedProducts = await prisma.product.findMany({
    where: {
      OR: [
        { merchantName: product.merchantName },
        { category: product.category },
      ],
      NOT: { id: product.id }, // Exclude the current product
      imageUrl: { not: null, not: '' },
    },
    take: 6,
    orderBy: { lastFetchedAt: 'desc' },
    include: { advertiser: true },
  });

  const displayPrice = product.price.toFixed(2);
  const displayOriginalPrice = product.originalPrice?.toFixed(2);
  const displayDiscount = product.discountPercentage ? `${product.discountPercentage.toFixed(0)}% OFF` : null;

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <nav className="text-sm text-gray-500 mb-6">
          <Link href="/" className="hover:underline text-blue-600">Home</Link>
          <span className="mx-1">/</span>
          <Link href={`/${slugify(product.category || '', { lower: true, strict: true })}`} className="hover:underline text-blue-600 capitalize">
            {product.category}
          </Link>
          <span className="mx-1">/</span>
          <span className="text-gray-700">{product.name}</span>
        </nav>

        <div className="bg-white rounded-lg shadow-md p-6 lg:flex lg:space-x-8 mb-8 border border-gray-200">
          <div className="lg:w-1/2 relative h-96 mb-6 lg:mb-0 bg-gray-100 flex items-center justify-center rounded-lg overflow-hidden border border-gray-300">
            {product.imageUrl && (
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
                style={{ objectFit: 'contain' }}
                className="p-4"
              />
            )}
          </div>

          <div className="lg:w-1/2">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">{product.name}</h1>

            {product.merchantName && (
              <div className="flex items-center text-lg text-gray-600 mb-4">
                {product.merchantLogoUrl && (
                  <Image src={product.merchantLogoUrl} alt={`${product.merchantName} Logo`} width={32} height={32} className="rounded-full mr-2" />
                )}
                <span>Sold by: <span className="font-semibold">{product.merchantName}</span></span>
              </div>
            )}
            {product.brand && <p className="text-lg text-gray-600 mb-2">Brand: <span className="font-semibold">{product.brand}</span></p>}

            <div className="flex items-baseline mb-3">
              <span className="text-5xl font-extrabold text-green-600">${displayPrice}</span>
              {displayOriginalPrice && product.price < product.originalPrice! && (
                <span className="ml-3 text-xl text-gray-500 line-through">${displayOriginalPrice}</span>
              )}
              {displayDiscount && (
                <span className="ml-4 px-4 py-2 bg-red-100 text-red-700 text-xl font-bold rounded-full inline-block">
                  {displayDiscount}
                </span>
              )}
            </div>

            {product.availability && (
              <p className="text-gray-700 text-md mb-4">Availability: <span className="font-semibold">{product.availability}</span></p>
            )}
            <p className="text-gray-500 text-sm mb-4">Last updated: {product.lastFetchedAt.toLocaleDateString()}</p>

            {/* Affiliate Link CTA */}
            <ClientSideAffiliateButton product={product} />

            {product.couponCode && (
              <div className="mt-8 p-5 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                <h3 className="font-bold text-xl text-yellow-800 mb-3">Exclusive Coupon Available!</h3>
                <p className="text-gray-800 text-lg mb-4">
                  Use code: <span className="font-mono bg-yellow-200 px-3 py-1 rounded-md text-2xl font-bold text-yellow-900 select-all">{product.couponCode.code}</span>
                </p>
                <p className="text-gray-700 text-base mb-4">{product.couponCode.discount} - {product.couponCode.description}</p>
                <ClientSideCouponButton coupon={product.couponCode} />
                {product.couponCode.expirationDate && (
                  <p className="text-sm text-red-600 mt-3">Expires: {product.couponCode.expirationDate.toLocaleDateString()}</p>
                )}
                {product.couponCode.terms && (
                  <p className="text-xs text-gray-600 mt-2 line-clamp-2">{product.couponCode.terms}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <section className="bg-white rounded-lg shadow-md p-6 mb-8 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Product Description</h2>
          <div className="prose max-w-none text-gray-700 leading-relaxed">
            <p>{product.description || 'No detailed description available for this product.'}</p>
          </div>
        </section>

        {/* Related Products Section */}
        {relatedProducts.length > 0 && (
          <section className="mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">You Might Also Like</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {relatedProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}

        {/* SEO Content/User Reviews Section */}
        {/* Add a section for detailed reviews or structured content (from Article model) */}
      </main>
      <Footer />
    </>
  );
}

// ClientSideAffiliateButton.tsx (Client Component for tracking)
// src/components/ClientSideAffiliateButton.tsx
'use client';
import { sendGAEvent } from '@next/third-parties/google';
import Link from 'next/link';

type ProductForButton = {
  id: string;
  name: string;
  merchantName?: string | null;
  affiliateLink: string;
  advertiser: { name: string };
  category?: string | null;
}

export default function ClientSideAffiliateButton({ product }: { product: ProductForButton }) {
  const handleClick = () => {
    sendGAEvent({
      event: 'affiliate_click',
      value: product.affiliateLink,
      params: {
        item_id: product.id,
        item_name: product.name,
        merchant_name: product.merchantName,
        affiliate_partner: product.advertiser.name,
        link_url: product.affiliateLink,
        link_type: 'product_deal_detail',
        category: product.category,
      },
    });
  };

  return (
    <Link
      href={product.affiliateLink}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={handleClick}
      className="block bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg text-center text-xl transition-colors duration-200 mt-6 shadow-lg hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-300 focus:ring-offset-2"
    >
      View Deal at {product.merchantName || 'Merchant'}
    </Link>
  );
}