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
    });
});
