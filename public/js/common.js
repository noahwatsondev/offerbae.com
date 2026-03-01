// Shared logic for Fresh layout
document.addEventListener('DOMContentLoaded', function () {
    // Global/Delegated click handler for clipboard copying and dual-links
    document.addEventListener('click', function (e) {
        // Global dual-link handler for SEO-friendly product cards
        const dualLink = e.target.closest('.js-dual-link');
        if (dualLink) {
            e.preventDefault(); // Stop immediate current-tab navigation to ensure window.open fires
            const affiliateUrl = dualLink.getAttribute('data-affiliate-url');
            if (affiliateUrl && affiliateUrl !== '#') {
                const newTab = window.open(affiliateUrl, '_blank', 'noopener,noreferrer');
                // Don't blur the new tab—we want the user to see the merchant!
                // Let the background tab navigate to the product details page.
            }

            // Navigate current tab to the SEO product details page
            const targetUrl = dualLink.getAttribute('href');
            if (targetUrl && targetUrl !== '#') {
                window.location.href = targetUrl;
            }
            return; // Exit after handling dual-link
        }

        const wrapper = e.target.closest('.offer-card-wrapper');
        if (!wrapper) return;

        const isCode = wrapper.getAttribute('data-is-code') === 'true';
        const code = wrapper.getAttribute('data-code');

        if (isCode && code && code !== 'N/A') {
            try {
                navigator.clipboard.writeText(code).then(() => {
                    console.log('Code copied to clipboard:', code);

                    // Visual Feedback: Show "Copied!" briefly
                    const hint = wrapper.querySelector('.promo-copy-hint');
                    if (hint) {
                        const originalHtml = hint.innerHTML;
                        hint.innerHTML = '<span style="color: #10b981;">✓ Copied!</span>';
                        setTimeout(() => {
                            hint.innerHTML = originalHtml;
                        }, 2000);
                    }
                });
            } catch (err) {
                console.error('Failed to copy code:', err);
            }
        }
    });
});
