const puppeteer = require('puppeteer');

const PRODUCTS = [
  {id: 238, slug: "alpes"},
  {id: 223, slug: "alpes-malla"},
  {id: 237, slug: "alpes-paver"},
  {id: 239, slug: "arezzo"},
  {id: 224, slug: "arezzo-malla"},
  {id: 229, slug: "arezzo-paver"},
  {id: 231, slug: "cavour"},
  {id: 236, slug: "dolomitti"},
  {id: 230, slug: "emilia"},
  {id: 225, slug: "emilia-malla"},
  {id: 228, slug: "emilia-paver"},
  {id: 240, slug: "indigo"},
  {id: 226, slug: "indigo-malla"},
  {id: 227, slug: "indigo-paver"},
  {id: 232, slug: "livorno"},
  {id: 233, slug: "michelino"},
  {id: 234, slug: "sardegna"},
  {id: 235, slug: "valenciano"}
];

async function scrape(browser, slug) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');
  try {
    await page.goto(`https://www.cesantoni.com.mx/producto/${slug}/`, {
      waitUntil: 'networkidle2',
      timeout: 20000
    });
    await new Promise(r => setTimeout(r, 1000));

    const data = await page.evaluate(() => {
      const imgs = [];
      const related = [];
      document.querySelectorAll('img').forEach(img => {
        const src = img.src;
        if (src &&
            src.includes('uploads') &&
            (src.includes('1024') || src.includes('2048') || src.includes('scaled')) &&
            !src.includes('logo') &&
            !src.includes('PEI') &&
            !src.includes('square') &&
            !src.includes('Interior') &&
            !src.includes('Exterior')) {
          imgs.push(src.split('?')[0]);
        }
      });
      document.querySelectorAll('a[href*="/producto/"]').forEach(a => {
        const m = a.href.match(/\/producto\/([^\/]+)/);
        if (m && !a.href.includes('/en/') && !related.includes(m[1])) {
          related.push(m[1]);
        }
      });
      return {images: [...new Set(imgs)], related};
    });
    await page.close();
    return data;
  } catch(e) {
    await page.close();
    return {images: [], related: []};
  }
}

async function main() {
  console.log('Enriqueciendo 18 productos con slug nuevo...\n');
  const browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox']});

  let enriched = 0;
  for (const p of PRODUCTS) {
    const data = await scrape(browser, p.slug);
    if (data.images.length > 0) {
      const update = {
        image_url: data.images[0],
        gallery: JSON.stringify(data.images.slice(0, 6)),
        related_products: JSON.stringify(data.related.filter(r => r !== p.slug).slice(0, 4))
      };
      await fetch(`https://cesantoni-experience-za74.onrender.com/api/products/${p.id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(update)
      });
      console.log(`✓ ${p.slug}: ${data.images.length} imgs, ${data.related.length} related`);
      enriched++;
    } else {
      console.log(`✗ ${p.slug}: not found on cesantoni.com.mx`);
    }
  }

  await browser.close();
  console.log(`\nEnriquecidos: ${enriched}/18`);
}

main().catch(console.error);
