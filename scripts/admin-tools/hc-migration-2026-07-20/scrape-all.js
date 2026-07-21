// Scrape all 321+ products from heychoices.com paginated.
// Outputs:
//   /tmp/heychoices-all-products-full.json — single product[] array
// Logs progress to stdout.

const https = require('https');
const fs = require('fs');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { agent: false, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchJson(res.headers.location));
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' on ' + url));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const all = [];
  let page = 1;
  // Shopify products.json caps at 250/page, so page=1 gives us 250
  // and we use the Link header (rel="next") or a plain ?page=N retry.
  while (true) {
    const url = `https://www.heychoices.com/products.json?limit=250&page=${page}`;
    process.stdout.write(`page ${page} … `);
    const data = await fetchJson(url);
    const products = data.products || [];
    process.stdout.write(`got ${products.length} products\n`);
    all.push(...products);
    if (products.length < 250) break; // last page
    page += 1;
    if (page > 10) {
      console.error('safety cap hit — abort');
      break;
    }
  }
  // dedupe by id
  const seen = new Set();
  const dedup = all.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  console.log(`\nunique products: ${dedup.length}`);
  fs.writeFileSync('/tmp/heychoices-all-products-full.json', JSON.stringify(dedup, null, 2));
  console.log('saved to /tmp/heychoices-all-products-full.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
