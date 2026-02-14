const puppeteer = require('puppeteer');

async function scrapeImages(browser, slug) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');

  try {
    await page.goto(`https://www.cesantoni.com.mx/producto/${slug}/`, {
      waitUntil: 'networkidle2',
      timeout: 25000
    });
    await new Promise(r => setTimeout(r, 1500));

    const images = await page.evaluate((s) => {
      const found = [];
      document.querySelectorAll('img').forEach(img => {
        const src = img.src;
        const upperSlug = s.toUpperCase();
        const upperSrc = src.toUpperCase();

        // Get images that are renders or contain product name
        if (src &&
            src.includes('uploads') &&
            (upperSrc.includes(upperSlug) || src.includes('Render_')) &&
            (src.includes('1024') || src.includes('2048')) &&
            !src.includes('logo') &&
            !src.includes('PEI') &&
            !src.includes('square')) {
          found.push(src.split('?')[0]);
        }
      });
      return [...new Set(found)];
    }, slug);

    await page.close();
    return images;
  } catch(e) {
    console.log(`  Error scraping ${slug}:`, e.message);
    await page.close();
    return [];
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox']
  });

  const res = await fetch('https://cesantoni-experience-za74.onrender.com/api/products');
  const products = await res.json();

  const slugs = ['blendwood', 'denver', 'vermont', 'riverwood'];

  for (const slug of slugs) {
    const product = products.find(p => p.slug === slug);
    if (!product) {
      console.log(`${slug}: not found in DB`);
      continue;
    }

    const images = await scrapeImages(browser, slug);
    console.log(`${slug}: found ${images.length} images`);

    if (images.length > 0) {
      console.log(`  Main: ${images[0].split('/').pop()}`);

      const updateData = {
        image_url: images[0],
        gallery: JSON.stringify(images.slice(0, 4))
      };

      const updateRes = await fetch(`https://cesantoni-experience-za74.onrender.com/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      console.log(`  Updated: ${updateRes.ok ? 'OK' : 'FAIL'}`);
    }
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
