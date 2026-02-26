// OfferBae — Offer Click Flow (RetailMeNot-style)
// Handles: background tab open, URL pushState, modal show/hide

(function () {
    'use strict';

    // ---- Modal State ----
    let _currentBrandSlug = null;
    let _currentOffer = null;

    // ---- DOM helpers ----
    function el(id) { return document.getElementById(id); }

    // ---- Show modal with offer data ----
    function showOfferModal(offer) {
        _currentOffer = offer; // store for share URL construction
        // Brand name + logo
        el('offer-modal-brand-name').textContent = offer.advertiser || offer.brandName || 'Brand Deal';
        const logoWrap = el('offer-modal-logo-wrap');
        const logoImg = el('offer-modal-logo');
        if (offer.brandLogo || offer.logoUrl) {
            logoImg.src = offer.brandLogo || offer.logoUrl;
            logoImg.alt = offer.advertiser || '';
            logoWrap.style.display = 'flex';
        } else {
            logoWrap.style.display = 'none';
        }

        // Type badge
        const badge = el('offer-modal-type-badge');
        if (offer.isPromoCode) {
            badge.textContent = 'Promo Code';
            badge.className = 'offer-modal-type-badge is-code';
        } else {
            badge.textContent = 'Deal';
            badge.className = 'offer-modal-type-badge is-deal';
        }

        // Title
        el('offer-modal-title').textContent = offer.description || 'Exclusive Offer';

        // Promo code section
        const codeSection = el('offer-modal-code-section');
        const codeBox = el('offer-modal-code');
        if (offer.isPromoCode && offer.code && offer.code !== 'N/A') {
            codeBox.textContent = offer.code;
            codeSection.style.display = 'block';
        } else {
            codeSection.style.display = 'none';
        }

        // CTA button
        const affiliateUrl = offer.clickUrl || offer.link || '#';
        el('offer-modal-btn').href = affiliateUrl;

        // Expiry
        const expiryEl = el('offer-modal-expiry');
        expiryEl.textContent = offer.expiresAt ? 'Expires: ' + offer.expiresAt : '';

        // Show modal
        el('offer-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    // ---- Hide modal ----
    function closeOfferModal() {
        el('offer-modal').style.display = 'none';
        document.body.style.overflow = '';
        if (_currentBrandSlug) {
            history.replaceState({}, '', '/brands/' + _currentBrandSlug);
        }
        _currentBrandSlug = null;
    }

    // ---- Copy code to clipboard ----
    window.offerModalCopyCode = function () {
        const code = el('offer-modal-code').textContent;
        if (!code) return;
        navigator.clipboard.writeText(code).then(function () {
            const btn = el('offer-modal-copy-btn');
            const orig = btn.innerHTML;
            btn.textContent = 'Copied!';
            setTimeout(function () { btn.innerHTML = orig; }, 1800);
        }).catch(function () {
            // Fallback for older browsers
            const ta = document.createElement('textarea');
            ta.value = code;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    };

    // ---- Copy offer share URL to clipboard ----
    window.offerModalShare = function () {
        if (!_currentOffer || !_currentOffer.id || !_currentOffer.brandSlug) return;
        const shareUrl = window.location.origin + '/offers/' + _currentOffer.brandSlug + '/' + _currentOffer.id;
        const shareBtn = el('offer-modal-share');
        navigator.clipboard.writeText(shareUrl).then(function () {
            if (shareBtn) {
                const orig = shareBtn.innerHTML;
                shareBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                shareBtn.style.color = '#10b981';
                setTimeout(function () {
                    shareBtn.innerHTML = orig;
                    shareBtn.style.color = '';
                }, 1800);
            }
        }).catch(function () {
            const ta = document.createElement('textarea');
            ta.value = shareUrl;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    };

    // ---- Handle offer card click ----
    function handleOfferClick(e) {
        e.preventDefault();
        e.stopPropagation();

        const wrapper = e.currentTarget;
        const offerId = wrapper.dataset.offerId;
        const brandSlug = wrapper.dataset.brandSlug;
        const affiliateUrl = wrapper.dataset.affiliateUrl;

        // Parse offer data from data attribute
        let offer = {};
        try { offer = JSON.parse(decodeURIComponent(wrapper.dataset.offerJson || '{}')); } catch (_) { }

        // 1. Open affiliate URL in a background tab
        if (affiliateUrl && affiliateUrl !== '#') {
            const newTab = window.open(affiliateUrl, '_blank', 'noopener,noreferrer');
            // Attempt to keep focus on the current tab (works in Chrome/Firefox)
            if (newTab) {
                newTab.blur();
                window.focus();
            }
        }

        // 2. Update URL via pushState
        if (offerId && brandSlug) {
            _currentBrandSlug = brandSlug;
            history.pushState({ offerId, brandSlug }, '', '/offers/' + brandSlug + '/' + offerId);
        }

        // 3. Show modal
        showOfferModal(offer);
    }

    // ---- Attach click handlers to all offer card wrappers ----
    function initOfferCards() {
        document.querySelectorAll('.offer-card-wrapper[data-offer-id]').forEach(function (wrapper) {
            wrapper.addEventListener('click', handleOfferClick);
        });
    }

    // ---- Close modal on backdrop/button click ----
    function initModalClose() {
        const closeBtn = el('offer-modal-close');
        const backdrop = el('offer-modal-backdrop');
        if (closeBtn) closeBtn.addEventListener('click', closeOfferModal);
        if (backdrop) backdrop.addEventListener('click', closeOfferModal);

        // ESC key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeOfferModal();
        });
    }

    // ---- Handle browser back/forward ----
    window.addEventListener('popstate', function () {
        if (!window.location.pathname.startsWith('/offers/')) {
            closeOfferModal();
        }
    });

    // ---- Init on DOM ready ----
    document.addEventListener('DOMContentLoaded', function () {
        initOfferCards();
        initModalClose();

        // Auto-open if server injected a modal offer (direct URL visit)
        if (window.__MODAL_OFFER__) {
            _currentBrandSlug = window.__MODAL_OFFER__.brandSlug ||
                window.location.pathname.split('/')[2] || null;
            showOfferModal(window.__MODAL_OFFER__);
        }
    });
})();
