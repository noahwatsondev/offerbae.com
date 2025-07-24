// src/components/ProductCard.tsx
'use client'; // This is a client component
import Image from 'next/image';
import Link from 'next/link';
import { sendGAEvent } from '@next/third-parties/google'; // Import GA4 event sender

type ProductProps = {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string | null;
  price: number;
  originalPrice?: number | null;
  discountPercentage?: number | null;
  merchantName?: string | null;
  merchantLogoUrl?: string | null; // Added merchant logo URL
  affiliateLink: string;
  description?: string | null;
  advertiser: { name: string };
};

export default function ProductCard({ product }: { product: ProductProps }) {
  const handleClick = () => {
    // Track the affiliate link click
    sendGAEvent({
      event: 'affiliate_click',
      value: product.affiliateLink,
      params: {
        item_id: product.id,
        item_name: product.name,
        merchant_name: product.merchantName,
        affiliate_partner: product.advertiser.name,
        link_url: product.affiliateLink,
        link_type: 'product_deal',
      },
    });
  };

  const displayPrice = product.price.toFixed(2);
  const displayOriginalPrice = product.originalPrice?.toFixed(2);
  const displayDiscount = product.discountPercentage ? `${product.discountPercentage.toFixed(0)}% OFF` : null;

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden flex flex-col h-full border border-gray-200 hover:shadow-xl transform hover:-translate-y-1 transition-all duration-200">
      {product.imageUrl && (
        <div className="relative w-full h-48 bg-gray-100 flex items-center justify-center p-4"> {/* Added padding to image container */}
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            style={{ objectFit: 'contain' }}
            className="rounded-t-lg"
          />
        </div>
      )}
      <div className="p-4 flex flex-col flex-grow">
        {product.merchantName && (
          <div className="flex items-center mb-2">
            {product.merchantLogoUrl && (
              <Image src={product.merchantLogoUrl} alt={`${product.merchantName} Logo`} width={24} height={24} className="rounded-full mr-2" />
            )}
            <p className="text-sm text-gray-500 font-medium">{product.merchantName}</p>
          </div>
        )}
        <h2 className="text-xl font-semibold mb-2 line-clamp-2 text-gray-800">{product.name}</h2>

        <div className="flex items-baseline mb-3">
          <span className="text-3xl font-extrabold text-green-600">${displayPrice}</span>
          {displayOriginalPrice && product.price < product.originalPrice! && (
            <span className="ml-2 text-base text-gray-500 line-through">${displayOriginalPrice}</span>
          )}
          {displayDiscount && (
            <span className="ml-3 px-2 py-1 bg-red-100 text-red-700 text-sm font-bold rounded-full">
              {displayDiscount}
            </span>
          )}
        </div>

        <p className="text-gray-700 text-sm mb-4 line-clamp-3 flex-grow">
          {product.description || 'No description available.'}
        </p>
        <div className="mt-auto"> {/* Pushes the button to the bottom */}
          <Link
            href={product.affiliateLink}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={handleClick}
            className="block bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-center text-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            View Deal
          </Link>
        </div>
      </div>
    </div>
  );
}