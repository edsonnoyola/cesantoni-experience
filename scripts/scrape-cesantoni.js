const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.cesantoni.com.mx';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'scraped-products.json');

async function scrapeProductList(browser) {
  console.log('Fetching product list from cesantoni.com.mx...');
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  const allProductLinks = new Set();

  // Explore multiple category/filter pages
  const pagesToScrape = [
    `${BASE_URL}/productos/`,
    `${BASE_URL}/productos/?_acabado=mate`,
    `${BASE_URL}/productos/?_acabado=pulido`,
    `${BASE_URL}/productos/?_acabado=satinado`,
    `${BASE_URL}/productos/?_acabado=grip`,
    `${BASE_URL}/productos/?_acabado=rigato`,
    `${BASE_URL}/productos/?_acabado=velvet-finish`,
    `${BASE_URL}/productos/?_novedad=1`,
    `${BASE_URL}/productos/?_categoria=madera`,
    `${BASE_URL}/productos/?_categoria=marmol`,
    `${BASE_URL}/productos/?_categoria=piedra`,
    `${BASE_URL}/productos/?_categoria=cemento`,
  ];

  for (const pageUrl of pagesToScrape) {
    try {
      console.log(`  Scanning: ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 1500));

      // Extract all product links
      const links = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a[href*="/producto/"]');
        return Array.from(anchors)
          .map(a => a.href)
          .filter(href => href && href.includes('/producto/') && !href.includes('#'));
      });

      links.forEach(link => allProductLinks.add(link));
      console.log(`    Found ${links.length} links (total unique: ${allProductLinks.size})`);
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
  }

  await page.close();
  return Array.from(allProductLinks);
}

async function scrapeProduct(browser, url) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  try {
    console.log(`Scraping: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for content to load
    await new Promise(r => setTimeout(r, 2000));

    // Extract product data
    const productData = await page.evaluate(() => {
      const data = {
        url: window.location.href,
        name: '',
        sku: '',
        slug: '',
        pei: '',
        format: '',
        type: '',
        category: '',
        uses: [],
        finish: '',
        images: [],
        gallery: [],
        relatedSlugs: []  // Productos similares
      };

      // Get product name from title or h1
      const titleEl = document.querySelector('h1, .product-title, [class*="title"]');
      if (titleEl) {
        data.name = titleEl.textContent.trim();
      }

      // Extract slug from URL
      const urlParts = window.location.pathname.split('/').filter(Boolean);
      data.slug = urlParts[urlParts.length - 1]?.toLowerCase() || '';
      data.sku = data.slug.toUpperCase();

      // Find all text content to extract specs
      const allText = document.body.innerText;

      // PEI extraction
      const peiMatch = allText.match(/PEI\s*[IVX]+\s*\(?([^)]*)\)?/i);
      if (peiMatch) {
        data.pei = peiMatch[0].trim();
      }

      // Format extraction (e.g., "20x120 CM", "60x60 CM")
      const formatMatch = allText.match(/(\d+\s*[xX]\s*\d+)\s*CM/i);
      if (formatMatch) {
        data.format = formatMatch[0].trim();
      }

      // Type extraction
      const typePatterns = [
        /PORCELÁNICO\s*RECTIFICADO/i,
        /PORCELÁNICO/i,
        /PASTA\s*BLANCA/i,
        /PASTA\s*ROJA/i,
        /CERÁMICO/i
      ];
      for (const pattern of typePatterns) {
        const match = allText.match(pattern);
        if (match) {
          data.type = match[0].trim();
          break;
        }
      }

      // Category extraction
      const categoryPatterns = [
        /MADERA/i, /MÁRMOL/i, /PIEDRA/i, /CEMENTO/i,
        /CONCRETO/i, /METAL/i, /TEXTIL/i, /DECORADO/i
      ];
      for (const pattern of categoryPatterns) {
        if (pattern.test(allText)) {
          data.category = pattern.source.replace(/\\s\*/g, ' ').toUpperCase();
          break;
        }
      }

      // Uses extraction
      const usePatterns = ['BAÑO', 'COCINA', 'EXTERIOR', 'INTERIOR', 'COMERCIAL', 'RESIDENCIAL', 'PISCINA', 'FACHADA'];
      usePatterns.forEach(use => {
        if (allText.toUpperCase().includes(use)) {
          data.uses.push(use);
        }
      });

      // Finish extraction
      const finishPatterns = [
        /UNITONO/i, /MULTITONO/i, /MATE/i, /BRILLANTE/i,
        /PULIDO/i, /RÚSTICO/i, /SATINADO/i, /ESTRUCTURADO/i
      ];
      for (const pattern of finishPatterns) {
        if (pattern.test(allText)) {
          data.finish = pattern.source.toUpperCase();
          break;
        }
      }

      // Extract images
      const images = document.querySelectorAll('img[src*="uploads"], img[src*="producto"], .gallery img, [class*="slider"] img, [class*="carousel"] img');
      images.forEach(img => {
        const src = img.src || img.dataset.src || img.dataset.lazySrc;
        if (src && src.includes('cesantoni') && !src.includes('logo') && !src.includes('icon')) {
          if (!data.images.includes(src)) {
            data.images.push(src);
          }
        }
      });

      // Also look for background images
      const elementsWithBg = document.querySelectorAll('[style*="background-image"]');
      elementsWithBg.forEach(el => {
        const style = el.getAttribute('style');
        const match = style?.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (match && match[1] && match[1].includes('cesantoni') && !match[1].includes('logo')) {
          if (!data.images.includes(match[1])) {
            data.images.push(match[1]);
          }
        }
      });

      // Extract related/similar products
      const currentSlug = data.slug;
      const relatedLinks = document.querySelectorAll('a[href*="/producto/"]');
      relatedLinks.forEach(link => {
        const href = link.href;
        if (href && href.includes('/producto/')) {
          const match = href.match(/\/producto\/([^\/\?#]+)/);
          if (match && match[1]) {
            const slug = match[1].toLowerCase();
            // Exclude current product and english version
            if (slug !== currentSlug && !href.includes('/en/') && !data.relatedSlugs.includes(slug)) {
              data.relatedSlugs.push(slug);
            }
          }
        }
      });

      return data;
    });

    await page.close();
    return productData;

  } catch (error) {
    console.error(`Error scraping ${url}: ${error.message}`);
    await page.close();
    return null;
  }
}

async function main() {
  console.log('Starting Cesantoni scraper...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // Get list of all products
    const productLinks = await scrapeProductList(browser);

    if (productLinks.length === 0) {
      console.log('No products found. Trying direct scrape...');
      // Try some known products
      productLinks.push(
        `${BASE_URL}/producto/nekk/`,
        `${BASE_URL}/producto/volterra/`,
        `${BASE_URL}/producto/carrara/`
      );
    }

    // Scrape each product
    const products = [];
    for (let i = 0; i < productLinks.length; i++) {
      const url = productLinks[i];
      const product = await scrapeProduct(browser, url);
      if (product && product.name) {
        products.push(product);
        console.log(`  ✓ ${product.name} - ${product.format || 'N/A'} - PEI: ${product.pei || 'N/A'}`);
      }

      // Small delay between requests
      if (i < productLinks.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Save results
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(products, null, 2));
    console.log(`\n✓ Scraped ${products.length} products`);
    console.log(`✓ Saved to ${OUTPUT_FILE}`);

    // Print summary
    console.log('\n=== Summary ===');
    products.forEach(p => {
      console.log(`- ${p.name}: ${p.format}, ${p.type}, Uses: ${p.uses.join(', ')}`);
    });

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
