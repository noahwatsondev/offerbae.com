// Shared logic for Fresh layout
document.addEventListener('DOMContentLoaded', function () {
    // Global/Delegated click handler for clipboard copying
    document.addEventListener('click', function (e) {
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

        // Global dual-link handler for SEO-friendly product cards
        const dualLink = e.target.closest('.js-dual-link');
        if (dualLink) {
            const affiliateUrl = dualLink.getAttribute('data-affiliate-url');
            if (affiliateUrl && affiliateUrl !== '#') {
                const newTab = window.open(affiliateUrl, '_blank', 'noopener,noreferrer');
                if (newTab) {
                    newTab.blur();
                    window.focus();
                }
            }
            // Do not prevent default; allow the native href to open in the current tab.
            // GA4 tracking relies on this being an affiliate link click, but since we 
            // changed the href to a relative URL, we should ensure GA4 still tracks it.
            // (GA4 tracking is handled in header-scripts.ejs, we may need to adjust it there if needed)
        }
    });
});
