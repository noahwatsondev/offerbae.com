// src/app/coupons/[merchantSlug]/page.tsx
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import ClientSideCouponButton from '@/components/ClientSideCouponButton'; // Re-use this component
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import slugify from 'slugify';
import Link from 'next/link';

// Can use generateStaticParams for popular merchants or SSR for all
export async function generateStaticParams() {
  const merchants = await prisma.couponCode.findMany({
    select: { merchantName: true },
    distinct: ['merchantName'],
    where: { merchantName: { not: null, not: '' } }
  });
  return merchants.map((m) => ({
    merchantSlug: slugify(m.merchantName, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g }),
  }));
}

export const revalidate = 3600; // Revalidate every hour

export default async function MerchantCouponsPage({
  params,
}: {
  params: { merchantSlug: string };
}) {
  const displayMerchantSlug = params.merchantSlug;

  const merchantMapping = await prisma.couponCode.findFirst({
    where: {
      OR: [
        { merchantName: { equals: displayMerchantSlug.replace(/-/g, ' '), mode: 'insensitive' } }, // Try direct match with reverse slugify
        { merchantLogoUrl: { contains: displayMerchantSlug, mode: 'insensitive' } } // Maybe slug is part of logo URL? (less reliable)
      ]
    },
    select: { merchantName: true, merchantLogoUrl: true }
  });

  if (!merchantMapping?.merchantName) {
    notFound();
  }

  const couponCodes = await prisma.couponCode.findMany({
    where: {
      merchantName: merchantMapping.merchantName,
      isActive: true,
      OR: [
        { expirationDate: { gte: new Date() } },
        { expirationDate: null } // No expiration date
      ]
    },
    orderBy: [{ lastVerified: 'desc' }, { createdAt: 'desc' }],
    include: { advertiser: true },
  });

  return (
    <>
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-6 mb-8 text-center border border-gray-200">
          {merchantMapping.merchantLogoUrl && (
            <div className="relative w-32 h-32 mx-auto mb-4">
              <Image
                src={merchantMapping.merchantLogoUrl}
                alt={`${merchantMapping.merchantName} Logo`}
                fill
                sizes="100vw"
                style={{ objectFit: 'contain' }}
                className="rounded-full"
              />
            </div>
          )}
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            {merchantMapping.merchantName} Coupon Codes & Deals
          </h1>
          <p className="text-lg text-gray-700">
            Find the latest verified coupon codes and exclusive discounts for {merchantMapping.merchantName}. Maximize your savings on every purchase!
          </p>
        </div>

        {couponCodes.length === 0 ? (
          <p className="text-xl text-gray-600 text-center py-12 bg-white rounded-lg shadow-md">
            No active coupon codes found for {merchantMapping.merchantName} at this time. Check back soon!
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {couponCodes.map((coupon) => (
              <div key={coupon.id} className="bg-white rounded-lg shadow-md p-6 flex flex-col border border-dashed border-gray-300 hover:shadow-lg transform hover:-translate-y-1 transition-all duration-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-extrabold text-blue-700">{coupon.discount}</h2>
                  {coupon.expirationDate && (
                    <span className="text-sm text-red-600 font-semibold">Expires: {coupon.expirationDate.toLocaleDateString()}</span>
                  )}
                </div>
                <p className="text-gray-700 text-lg mb-4 flex-grow">{coupon.description}</p>

                <div className="bg-gray-100 p-4 rounded-lg border border-gray-200 flex items-center justify-between flex-wrap gap-2 mb-4">
                  {coupon.code ? (
                    <>
                      <div className="flex-grow text-center">
                        <span className="block text-sm text-gray-600 mb-1">Coupon Code:</span>
                        <span className="font-mono text-3xl font-extrabold text-green-700 select-all">{coupon.code}</span>
                      </div>
                      <ClientSideCouponButton coupon={coupon} />
                    </>
                  ) : (
                    <div className="flex-grow text-center">
                      <span className="block text-sm text-gray-600 mb-1">No Code Needed</span>
                      <span className="font-bold text-xl text-purple-700">Automatic Discount!</span>
                      <ClientSideCouponButton coupon={coupon} isNoCode={true} />
                    </div>
                  )}
                </div>

                {coupon.terms && (
                  <details className="text-sm text-gray-600 mt-2 cursor-pointer">
                    <summary className="font-semibold text-blue-600 hover:underline">View Terms & Conditions</summary>
                    <p className="mt-2 text-xs leading-relaxed">{coupon.terms}</p>
                  </details>
                )}
                <p className="text-xs text-gray-500 mt-auto pt-2 border-t border-gray-100">
                  Last Verified: {coupon.lastVerified.toLocaleDateString()} | Used: {coupon.timesUsed} times
                </p>
              </div>
            ))}
          </div>
        )}
        {/* Optional: Section for relevant products from this merchant */}
        {/* <section className="mt-12">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Popular Products from {merchantMapping.merchantName}</h2>
          {/ * Fetch and display product cards * /}
        </section> */}
      </main>
      <Footer />
    </>
  );
}

// src/components/ClientSideCouponButton.tsx (Client Component)
'use client';
import { sendGAEvent } from '@next/third-parties/google';
import { useState } from 'react';
import { usePathname } from 'next/navigation'; // To distinguish coupon button context

type CouponForButton = {
  id: string;
  code: string | null;
  discount: string;
  description: string | null;
  merchantName: string;
  affiliateLink: string;
  advertiser: { name: string };
}

export default function ClientSideCouponButton({ coupon, isNoCode = false }: { coupon: CouponForButton, isNoCode?: boolean }) {
  const [buttonText, setButtonText] = useState(isNoCode ? 'Get Deal' : 'View Code');
  const pathname = usePathname();

  const handleClick = () => {
    if (coupon.code) {
      navigator.clipboard.writeText(coupon.code).then(() => {
        setButtonText('Code Copied!');
        setTimeout(() => setButtonText('View Code'), 3000);
      }).catch(err => {
        console.error('Failed to copy text: ', err);
        setButtonText('Error Copying');
      });
    }

    // Track the affiliate link click
    sendGAEvent({
      event: 'affiliate_click',
      value: coupon.affiliateLink,
      params: {
        item_id: coupon.id,
        item_name: `Coupon: ${coupon.code || coupon.discount}`,
        merchant_name: coupon.merchantName,
        affiliate_partner: coupon.advertiser.name,
        link_url: coupon.affiliateLink,
        link_type: isNoCode ? 'coupon_no_code_deal' : 'coupon_code_reveal',
        page_context: pathname, // To understand where the click happened
      },
    });

    // Open merchant link in new tab
    window.open(coupon.affiliateLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      onClick={handleClick}
      className={`
        ${isNoCode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-green-600 hover:bg-green-700'}
        text-white font-bold py-3 px-6 rounded-lg text-center whitespace-nowrap transition-colors duration-200
        shadow-md hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-offset-2
        ${isNoCode ? 'focus:ring-purple-300' : 'focus:ring-green-300'}
      `}
    >
      {buttonText}
    </button>
  );
}