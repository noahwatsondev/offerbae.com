const getNum = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return v;
    const num = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isNaN(num) ? 0 : num;
};

const formatPrice = (v) => {
    const num = getNum(v);
    if (num <= 0) return '--';
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const checkIsSale = (price, salePrice) => {
    const p = getNum(price);
    const s = getNum(salePrice);
    return s > 0 && p > s;
};

const isRealCode = (code) => {
    if (!code) return false;
    const clean = String(code).trim().toUpperCase();
    const nonCodes = [
        'N/A', 'NONE', 'NO CODE', 'NO CODE REQUIRED', 'NO COUPON CODE',
        'NO COUPON CODE REQUIRED', 'NO COUPON REQUIRED', 'NO PROMO CODE REQUIRED',
        'NO PROMO REQUIRED', 'SEE SITE', 'CLICK TO REVEAL', 'AUTO-APPLIED',
        'ONLINE ONLY', 'NULL', 'UNDEFINED', '', 'NO CODE NEEDED'
    ];
    return !nonCodes.includes(clean);
};

const formatTimeLeft = (endDateStr) => {
    if (!endDateStr || endDateStr.startsWith('0000-00-00')) return '<span style="color: #10b981; font-weight: 700;">Never Expires</span>';
    const end = new Date(endDateStr);
    if (isNaN(end.getTime())) return '<span style="color: #10b981; font-weight: 700;">Never Expires</span>';

    const now = new Date();
    const diff = end - now;
    if (diff <= 0) return `<span style="color: #ef4444; font-weight: 700;">Expired (${end.toLocaleDateString()})</span>`;

    const msPerDay = 86400000;
    const msPerYear = msPerDay * 365.25;
    const years = Math.floor(diff / msPerYear);
    const days = Math.floor((diff % msPerYear) / msPerDay);
    const hours = Math.floor((diff % msPerDay) / 3600000);

    let p = [];
    if (years > 0) p.push(`<b>${years}</b> year${years !== 1 ? 's' : ''}`);
    if (days > 0 || years > 0) p.push(`<b>${days}</b> day${days !== 1 ? 's' : ''}`);
    p.push(`<b>${hours}</b> hour${hours !== 1 ? 's' : ''}`);

    const isUrgent = diff < msPerDay * 7;
    return `<span style="color: ${isUrgent ? '#ef4444' : '#10b981'}; font-weight: 500;">${p.join(', ')}</span>`;
};

module.exports = {
    getNum,
    formatPrice,
    checkIsSale,
    isRealCode,
    formatTimeLeft
};
