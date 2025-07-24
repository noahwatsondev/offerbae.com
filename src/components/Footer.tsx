// src/components/Footer.tsx
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-800 text-gray-300 py-8 mt-16">
      <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <h3 className="text-xl font-bold text-white mb-4">OfferBae</h3>
          <p className="text-sm">Your trusted source for the best deals, discounts, and coupon codes.</p>
          <p className="text-xs mt-4">
            <span className="font-semibold">Affiliate Disclosure:</span> We may earn a commission when you purchase through links on our site.
          </p>
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-4">Quick Links</h3>
          <ul className="space-y-2">
            <li><Link href="/about" className="hover:text-white transition-colors duration-200">About Us</Link></li>
            <li><Link href="/contact" className="hover:text-white transition-colors duration-200">Contact</Link></li>
            <li><Link href="/privacy" className="hover:text-white transition-colors duration-200">Privacy Policy</Link></li>
            <li><Link href="/terms" className="hover:text-white transition-colors duration-200">Terms of Service</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-4">Follow Us</h3>
          <div className="flex space-x-4">
            {/* Add social media icons/links here */}
            <a href="#" className="hover:text-white transition-colors duration-200">Facebook</a>
            <a href="#" className="hover:text-white transition-colors duration-200">Twitter</a>
            <a href="#" className="hover:text-white transition-colors duration-200">Instagram</a>
          </div>
        </div>
      </div>
      <div className="text-center text-sm text-gray-500 mt-8 border-t border-gray-700 pt-4">
        &copy; {new Date().getFullYear()} OfferBae. All rights reserved.
      </div>
    </footer>
  );
}