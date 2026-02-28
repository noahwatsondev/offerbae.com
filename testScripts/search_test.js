const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto('http://localhost:3000');
  
  await page.click('#search-input');
  await page.type('#search-input', 'misook');
  await page.waitForSelector('.search-result-item .brand-logo-icon', { timeout: 5000 });
  await page.screenshot({ path: 'testScripts/search_results_misook.png' });
  
  await page.evaluate(() => document.querySelector('#search-input').value = '');
  await page.type('#search-input', 'vacuum eufy');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'testScripts/search_results_eufy.png' });
  
  await browser.close();
})();
