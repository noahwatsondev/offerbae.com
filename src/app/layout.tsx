import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast'; // Import Toaster
import { GoogleAnalytics } from '@next/third-parties/google';
import { SessionProvider } from '@/components/SessionProvider'; // For NextAuth.js on client-side

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'OfferBae - Your Ultimate Deal Finder',
  description: 'Find the best deals, coupon codes, and product reviews for electronics, apparel, travel, and more.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SessionProvider> {/* Wrap your app with SessionProvider */}
          {children}
          <Toaster />
        </SessionProvider>
      </body>
      {/* Google Analytics 4 Script */}
      {process.env.NEXT_PUBLIC_GA_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
      )}
    </html>
  );
}