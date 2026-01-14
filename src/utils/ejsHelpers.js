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
        'ONLINE ONLY', 'NULL', 'UNDEFINED', ''
    ];
    return !nonCodes.includes(clean);
};

module.exports = {
    getNum,
    formatPrice,
    checkIsSale,
    isRealCode
};
