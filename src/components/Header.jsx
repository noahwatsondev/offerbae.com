import React from 'react';
import { Link } from 'react-router-dom';

const Header = () => {
    return (
        <header className="bg-white shadow-md">
            <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                <Link to="/" className="text-2x1 font-bold text-gray-800">OfferBae</Link>
                <nav className="space-x-4">
                    <Link to="/brands" className="text-gray-600 hover:text-gray-900">Brands</Link>
                    <Link to="/coupons" className="text-gray-600 hover:text-gray-900">Coupons</Link>
                    <Link to="/missioncontrol" className="text-gray-600 hover:text-gray-900">Mission Control</Link>
                </nav>
            </div>
        </header>
    );
};

export default Header;