document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('fresh-search-input');
    const resultsContainer = document.getElementById('fresh-search-results');
    let debounceTimer;

    if (!searchInput || !resultsContainer) return;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const query = e.target.value.trim();

        if (query.length < 2) {
            resultsContainer.innerHTML = '';
            resultsContainer.classList.remove('active');
            return;
        }

        debounceTimer = setTimeout(() => {
            fetchResults(query);
        }, 300);
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.remove('active');
        }
    });

    // Open results on focus if there's content
    searchInput.addEventListener('focus', () => {
        if (resultsContainer.innerHTML.trim() !== '') {
            resultsContainer.classList.add('active');
        }
    });

    async function fetchResults(query) {
        try {
            const response = await fetch(`/api/fresh/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            renderResults(data);
        } catch (err) {
            console.error('Search error:', err);
        }
    }

    function renderResults(data) {
        let html = '';
        const { brands, products, offers } = data || {};

        if (!brands || !products || !offers || (brands.length === 0 && products.length === 0 && offers.length === 0)) {
            resultsContainer.innerHTML = '<div class="no-results">No matches found.</div>';
            resultsContainer.classList.add('active');
            return;
        }

        // Brands Section
        if (brands.length > 0) {
            html += `<div class="search-section">
                <div class="section-header">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l.77.78L12 21l7.58-7.59.77-.78a5.4 5.4 0 0 0 0-7.65z"></path></svg>
                    Brands
                </div>`;
            brands.forEach(brand => {
                html += `
                    <a href="/fresh/brands/${brand.slug}" class="search-result-item">
                        <div class="result-icon-wrapper">
                            ${brand.logoUrl ? `<img src="${brand.logoUrl}" alt="${brand.name}">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`}
                        </div>
                        <div class="result-info">
                            <span class="result-name">${brand.name}</span>
                            <span class="result-meta">View Products & Offers</span>
                        </div>
                    </a>
                `;
            });
            html += `</div>`;
        }

        // Products Section
        if (products.length > 0) {
            html += `<div class="search-section">
                <div class="section-header">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                    Products
                </div>`;
            products.forEach(product => {
                html += `
                    <a href="/fresh/products/${product.slug}" class="search-result-item">
                        <div class="result-icon-wrapper">
                            ${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.name}">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>`}
                        </div>
                        <div class="result-info">
                            <span class="result-name">${product.name}</span>
                            <span class="result-meta">View Product Details</span>
                        </div>
                    </a>
                `;
            });
            html += `</div>`;
        }

        // Offers Section
        if (offers.length > 0) {
            html += `<div class="search-section">
                <div class="section-header">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                    Offers
                </div>`;
            offers.forEach(offer => {
                html += `
                    <a href="/fresh/offers/${offer.id}" class="search-result-item">
                        <div class="result-icon-wrapper">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                                <path d="M7 15h.01"></path>
                                <path d="M11 15h.01"></path>
                                <path d="M15 15h.01"></path>
                            </svg>
                        </div>
                        <div class="result-info">
                            <span class="result-name">${offer.name}</span>
                            <span class="result-meta">${offer.advertiser} ${offer.isPromoCode ? '• Code Available' : ''}</span>
                        </div>
                    </a>
                `;
            });
            html += `</div>`;
        }

        resultsContainer.innerHTML = html;
        resultsContainer.classList.add('active');
    }
});
