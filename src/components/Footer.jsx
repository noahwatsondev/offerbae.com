import React from 'react';

const Footer = () => {
    const year = new Date().getFullYear();
    return (
        <footer className="bg-gray-800 text-white mt-auto">
            <div className="container mx-auto px-4 py-6 text-center">
                <p>&copy; {year} OfferBae.com. All rights reserved.</p>
            </div>
        </footer>
    );
};

export default Footer;