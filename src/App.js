import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';

// Public Pages
import HomePage from './pages/public/HomePage';
import BrandsPage from './pages/public/BrandsPage';
import BrandPage from './pages/public/BrandPage';
import ProductPage from './pages/public/ProductPage';
import CouponsPage from './pages/public/CouponsPage';

// Admin Pages
import AdminHomePage from './pages/admin/AdminHomePage';
import AdminBrandsPage from './pages/admin/AdminBrandsPage';
import AdminBrandPage from './pages/admin/AdminBrandPage';
import AdminProductPage from './pages/admin/AdminProductPage';
import AdminCouponsPage from './pages/admin/AdminCouponsPage';

const App = () => {
  return (
    <BrowserRouter>
      <div className="flex flex-col min-h-screen bg-gray-100">
        <Header />
        <main className="flex-grow">
          <Routes>
            
            {/* Public Routes */}
            <Route path="/" element={<HomePage />} />
            <Route path="/brands" element={<BrandsPage />} />
            <Route path="/brands/:brandSlug" element={<BrandPage />} />
            <Route path="/brands/:brandSlug/:productSlug" element={<ProductPage />} />
            <Route path="/coupons" element={<CouponsPage />} />

            {/* Admin Routes */}
            <Route path="/missioncontrol" element={<AdminHomePage />} />
            <Route path="/missioncontrol/brands" element={<AdminBrandsPage />} />
            <Route path="/missioncontrol/brand" element={<AdminBrandPage />} />
            <Route path="/missioncontrol/product" element={<AdminProductPage />} />
            <Route path="/missioncontrol/coupons" element={<AdminCouponsPage />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
};

export default App;