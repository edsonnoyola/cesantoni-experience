/**
 * Scrapes cesantoni.com.mx and updates products on Render via API
 */
const puppeteer = require('puppeteer');

const RENDER_API = process.env.RENDER_API || 'https://cesantoni-experience.onrender.com';

async function getProductsFromRender() {
  const res = await fetch(`${RENDER_API}/api/products`);
  return res.json();
}

async function updateProduct(id, data) {
  const res = await fetch(`${RENDER_API}/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.ok;
}

async function scrapeProduct(browser, slug) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  try {
    await page.goto(`https://www.cesantoni.com.mx/producto/${slug}/`, {
      waitUntil: 'networkidle2',
      timeout: 25000
    });
    await new Promise(r => setTimeout(r, 1200));

    const data = await page.evaluate((currentSlug) => {
      const result = { found: true, images: [], relatedSlugs: [] };

      if (document.body.innerText.includes('página no existe')) {
        result.found = false;
        return result;
      }

      // Images
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.dataset.src;
        if (src &&
            src.includes('cesantoni.com.mx') &&
            src.includes('/uploads/') &&
            !src.includes('logo') && !src.includes('Logo') &&
            !src.includes('icon') && !src.includes('cropped-') &&
            !src.includes('PEI-') && !src.includes('numero-de-caras') &&
            !src.includes('square-') && !src.includes('Exterior-1') &&
            !src.includes('Interior-1') && !src.includes('150x') && !src.includes('100x')) {
          const clean = src.split('?')[0];
          if (!result.images.includes(clean)) result.images.push(clean);
        }
      });

      // Related products
      document.querySelectorAll('a[href*="/producto/"]').forEach(link => {
        const m = link.href.match(/\/producto\/([^\/\?#]+)/);
        if (m && m[1] && m[1].toLowerCase() !== currentSlug && !link.href.includes('/en/')) {
          const rel = m[1].toLowerCase();
          if (!result.relatedSlugs.includes(rel)) result.relatedSlugs.push(rel);
        }
      });

      return result;
    }, slug);

    await page.close();
    return data;
  } catch (e) {
    await page.close();
    return { found: false };
  }
}

async function main() {
  console.log('Fetching products from Render...');
  const products = await getProductsFromRender();
  console.log(`Found ${products.length} products\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let updated = 0;
  let notFound = 0;

  try {
    for (const product of products) {
      const slug = product.slug;
      if (!slug) continue;

      process.stdout.write(`  ${product.name.padEnd(25)}`);

      const scraped = await scrapeProduct(browser, slug);

      if (scraped.found && (scraped.images.length > 0 || scraped.relatedSlugs.length > 0)) {
        const updateData = {};

        // Update gallery if we got more images
        if (scraped.images.length > 0) {
          updateData.gallery = JSON.stringify(scraped.images.slice(0, 8));
        }

        // Update related products
        if (scraped.relatedSlugs.length > 0) {
          updateData.related_products = JSON.stringify(scraped.relatedSlugs.slice(0, 4));
        }

        const success = await updateProduct(product.id, updateData);
        if (success) {
          console.log(`✓ ${scraped.images.length} imgs, ${scraped.relatedSlugs.length} related`);
          updated++;
        } else {
          console.log(`✗ API error`);
        }
      } else {
        console.log(`- not on cesantoni.com.mx`);
        notFound++;
      }

      // Delay
      await new Promise(r => setTimeout(r, 600));
    }
  } finally {
    await browser.close();
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Not found: ${notFound}`);
}

main().catch(console.error);
