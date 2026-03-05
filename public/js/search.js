document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const resultsContainer = document.getElementById('search-results');
    let debounceTimer;

    if (!searchInput || !resultsContainer) return;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);

        const searchToggle = document.getElementById('use-google-search');
        if (searchToggle && searchToggle.checked) {
            resultsContainer.innerHTML = '';
            resultsContainer.classList.remove('active');
            return;
        }

        const query = e.target.value.trim();
        if (query.length < 2) {
            resultsContainer.innerHTML = '';
            resultsContainer.classList.remove('active');
            return;
        }
        debounceTimer = setTimeout(() => fetchResults(query), 280);
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.remove('active');
        }
    });

    // Re-open results on focus if content exists
    searchInput.addEventListener('focus', () => {
        if (resultsContainer.innerHTML.trim()) {
            resultsContainer.classList.add('active');
        }
    });

    // Navigate to search on Enter key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            resultsContainer.classList.remove('active');
            searchInput.blur();
        }
    });

    async function fetchResults(query) {
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            renderResults(data);
        } catch (err) {
            console.error('Search error:', err);
        }
    }

    // --- SVG Icons ---
    const ICONS = {
        brand: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`,
        product: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
        offer: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
        category: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h7"/></svg>`,
    };

    function sectionHeader(icon, label) {
        return `<div class="section-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
            ${label}
        </div>`;
    }

    function resultItem(href, iconHtml, name, meta) {
        return `<a href="${href}" class="search-result-item">
            <div class="result-icon-wrapper">${iconHtml}</div>
            <div class="result-info">
                <span class="result-name">${escapeHtml(name)}</span>
                <span class="result-meta">${meta}</span>
            </div>
        </a>`;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderResults(data) {
        const { brands = [], products = [], offers = [], categoryBrands = [] } = data || {};
        const hasResults = brands.length || products.length || offers.length || categoryBrands.length;

        if (!hasResults) {
            resultsContainer.innerHTML = '<div class="no-results">No matches found.</div>';
            resultsContainer.classList.add('active');
            return;
        }

        let html = '';

        // --- Brands ---
        if (brands.length) {
            html += `<div class="search-section">${sectionHeader('<path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l.77.78L12 21l7.58-7.59.77-.78a5.4 5.4 0 0 0 0-7.65z"/>', 'Brands')}`;
            brands.forEach(brand => {
                const icon = brand.logoUrl
                    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" loading="lazy">`
                    : ICONS.brand;
                html += resultItem(`/brands/${brand.slug}`, icon, brand.name, 'View Products &amp; Offers');
            });
            html += `</div>`;
        }

        // --- Products ---
        if (products.length) {
            html += `<div class="search-section">${sectionHeader('<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>', 'Products')}`;
            products.forEach(product => {
                const href = (product.brandSlug && product.slug)
                    ? `/products/${product.brandSlug}/${product.slug}`
                    : '/products';
                const icon = product.imageUrl
                    ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy">`
                    : ICONS.product;
                const priceStr = product.salePrice && product.salePrice < product.price
                    ? `$${Number(product.salePrice).toFixed(2)} <s style="color:#9CA3AF;font-weight:normal">$${Number(product.price).toFixed(2)}</s>`
                    : product.price ? `$${Number(product.price).toFixed(2)}` : 'View product';

                const meta = [
                    product.brandName,
                    priceStr
                ].filter(Boolean).join(' • ');

                html += resultItem(href, icon, product.name, meta);
            });
            html += `</div>`;
        }

        // --- Offers ---
        if (offers.length) {
            html += `<div class="search-section">${sectionHeader('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>', 'Offers')}`;
            offers.forEach(offer => {
                const href = offer.brandSlug
                    ? `/offers/${offer.brandSlug}`
                    : '/offers';
                const icon = offer.brandLogo
                    ? `<img src="${escapeHtml(offer.brandLogo)}" alt="${escapeHtml(offer.advertiser)}" loading="lazy" class="brand-logo-icon">`
                    : ICONS.offer;
                const meta = [
                    offer.advertiser,
                    offer.isPromoCode ? 'Code Available' : ''
                ].filter(Boolean).join(' • ');
                html += resultItem(href, icon, offer.name, meta);
            });
            html += `</div>`;
        }

        // --- Category Brands ---
        if (categoryBrands.length) {
            html += `<div class="search-section">${sectionHeader('<path d="M4 6h16M4 12h16M4 18h7"/>', 'Related Brands by Category')}`;
            categoryBrands.forEach(brand => {
                const icon = brand.logoUrl
                    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" loading="lazy">`
                    : ICONS.brand;
                const cats = (brand.categories || []).slice(0, 2).join(', ');
                html += resultItem(`/brands/${brand.slug}`, icon, brand.name, cats || 'Browse brand');
            });
            html += `</div>`;
        }

        resultsContainer.innerHTML = html;
        resultsContainer.classList.add('active');
    }
});
