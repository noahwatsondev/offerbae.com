import React, { useState, useEffect } from 'react';
import { getRakutenAdvertisers, getCjAdvertisers } from '../../services/apiService';

const AdminBrandsPage = () => {
  const [rakutenData, setRakutenData] = useState(null);
  const [cjData, setCjData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [rakutenResponse, cjResponse] = await Promise.all([
          getRakutenAdvertisers(),
          getCjAdvertisers()
        ]);
        setRakutenData(rakutenResponse);
        setCjData(cjResponse);
      } catch (err) {
        // The centralized catch block now handles all API errors gracefully
        setError(err.message || "An unexpected error occurred while fetching data.");
        console.error("Fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-100">
        <p className="text-xl text-gray-500">Loading API data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-screen bg-red-100 p-6">
        <p className="text-xl text-red-700">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 bg-white shadow-lg rounded-lg my-8">
      <h1 className="text-4xl font-extrabold text-center text-gray-800 mb-6">Brands (Admin)</h1>
      <p className="text-center text-lg text-gray-600 mb-8">
        This is the admin view of the Brands page, showing successful API integration.
      </p>

      {/* Rakuten API Response Section */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-700 mb-4 border-b-2 pb-2">
          Rakuten Advertisers API Response
        </h2>
        <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto text-sm text-gray-800">
          {rakutenData ? JSON.stringify(rakutenData, null, 2) : "No data received from Rakuten API."}
        </pre>
      </div>

      {/* CJ API Response Section */}
      <div>
        <h2 className="text-3xl font-bold text-gray-700 mb-4 border-b-2 pb-2">
          Commission Junction (CJ) Advertisers API Response
        </h2>
        <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto text-sm text-gray-800">
          {cjData ? cjData : "No data received from CJ API."}
        </pre>
      </div>
    </div>
  );
};

export default AdminBrandsPage;
