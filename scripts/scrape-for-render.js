/**
 * Scrapes product data from cesantoni.com.mx for products that exist in Render
 * Extracts: more images, related products
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.cesantoni.com.mx';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'render-products-enriched.json');

// Products from Render that we want to enrich
const PRODUCTS_TO_SCRAPE = [
  'alabama', 'amberwood', 'andrea', 'aranza', 'ardem', 'astor',
  'bastille', 'bento', 'blendwood', 'boston', 'calacatta-gold',
  'carrara', 'chicago', 'denver', 'dublin', 'elegance',
  'firenze', 'florence', 'genova', 'havana', 'helsinki',
  'ibiza', 'jakarta', 'kyoto', 'lagos', 'lima', 'lisbon',
  'london', 'luxor', 'madrid', 'malibu', 'manhattan', 'maui',
  'milano', 'monaco', 'montreal', 'napoli', 'nashville', 'nepal',
  'nevada', 'oasis', 'oakland', 'onyx', 'oslo', 'oxford',
  'pacifico', 'palermo', 'paris', 'perla', 'petra', 'phoenix',
  'portland', 'praga', 'quebec', 'reno', 'rhodes', 'rio',
  'riverwood', 'roma', 'sahara', 'salzburg', 'sandstone', 'santorini',
  'seattle', 'sevilla', 'sicilia', 'siena', 'stockholm', 'sydney',
  'tahoe', 'texas', 'tokyo', 'toronto', 'tucson', 'valencia',
  'vancouver', 'vegas', 'veneto', 'vermont', 'vienna', 'vintage',
  'wellington', 'yorkshire', 'zanzibar', 'zurich'
];

async function scrapeProduct(browser, slug) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  const url = `${BASE_URL}/producto/${slug}/`;

  try {
    console.log(`  Scraping: ${slug}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    const data = await page.evaluate((currentSlug) => {
      const result = {
        slug: currentSlug,
        found: true,
        images: [],
        relatedSlugs: [],
        pei: '',
        format: '',
        type: '',
        category: '',
        uses: [],
        finish: ''
      };

      // Check if page exists (not 404)
      if (document.body.innerText.includes('página no existe') ||
          document.body.innerText.includes('Page not found')) {
        result.found = false;
        return result;
      }

      const allText = document.body.innerText;

      // PEI
      const peiMatch = allText.match(/PEI\s*[IVX]+\s*\(?([^)]*)\)?/i);
      if (peiMatch) result.pei = peiMatch[0].trim();

      // Format
      const formatMatch = allText.match(/(\d+\s*[xX]\s*\d+)\s*CM/i);
      if (formatMatch) result.format = formatMatch[0].trim();

      // Type
      if (/PORCELÁNICO\s*RECTIFICADO/i.test(allText)) result.type = 'PORCELÁNICO RECTIFICADO';
      else if (/PORCELÁNICO/i.test(allText)) result.type = 'PORCELÁNICO';
      else if (/PASTA\s*BLANCA/i.test(allText)) result.type = 'PASTA BLANCA';

      // Category
      const cats = ['MADERA', 'MÁRMOL', 'PIEDRA', 'CEMENTO', 'CONCRETO'];
      for (const cat of cats) {
        if (allText.toUpperCase().includes(cat)) {
          result.category = cat;
          break;
        }
      }

      // Uses
      const uses = ['BAÑO', 'COCINA', 'EXTERIOR', 'INTERIOR', 'COMERCIAL', 'RESIDENCIAL', 'FACHADA'];
      uses.forEach(use => {
        if (allText.toUpperCase().includes(use)) result.uses.push(use);
      });

      // Finish
      const finishes = ['MATE', 'BRILLANTE', 'PULIDO', 'SATINADO', 'RÚSTICO'];
      for (const f of finishes) {
        if (allText.toUpperCase().includes(f)) {
          result.finish = f;
          break;
        }
      }

      // Images - get ALL images from the page
      const allImages = document.querySelectorAll('img');
      allImages.forEach(img => {
        const src = img.src || img.dataset.src || img.dataset.lazySrc;
        if (src &&
            src.includes('cesantoni.com.mx') &&
            src.includes('/uploads/') &&
            !src.includes('logo') &&
            !src.includes('Logo') &&
            !src.includes('icon') &&
            !src.includes('cropped-') &&
            !src.includes('PEI-') &&
            !src.includes('numero-de-caras') &&
            !src.includes('square-') &&
            !src.includes('Exterior-1') &&
            !src.includes('Interior-1') &&
            !src.includes('100x') &&
            !src.includes('150x')) {
          if (!result.images.includes(src)) {
            result.images.push(src);
          }
        }
      });

      // Background images
      document.querySelectorAll('[style*="background-image"]').forEach(el => {
        const style = el.getAttribute('style');
        const match = style?.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (match && match[1] &&
            match[1].includes('cesantoni') &&
            match[1].includes('/uploads/') &&
            !match[1].includes('logo')) {
          if (!result.images.includes(match[1])) {
            result.images.push(match[1]);
          }
        }
      });

      // Related products
      document.querySelectorAll('a[href*="/producto/"]').forEach(link => {
        const href = link.href;
        if (href && href.includes('/producto/')) {
          const match = href.match(/\/producto\/([^\/\?#]+)/);
          if (match && match[1]) {
            const relSlug = match[1].toLowerCase();
            if (relSlug !== currentSlug &&
                !href.includes('/en/') &&
                !result.relatedSlugs.includes(relSlug)) {
              result.relatedSlugs.push(relSlug);
            }
          }
        }
      });

      return result;
    }, slug);

    await page.close();
    return data;

  } catch (error) {
    console.log(`    Error: ${error.message}`);
    await page.close();
    return { slug, found: false, error: error.message };
  }
}

async function main() {
  console.log('Scraping products for Render enrichment...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];
  let found = 0;

  try {
    for (let i = 0; i < PRODUCTS_TO_SCRAPE.length; i++) {
      const slug = PRODUCTS_TO_SCRAPE[i];
      const data = await scrapeProduct(browser, slug);

      if (data.found) {
        results.push(data);
        found++;
        console.log(`    ✓ ${slug}: ${data.images.length} imgs, ${data.relatedSlugs.length} related`);
      } else {
        console.log(`    ✗ ${slug}: not found`);
      }

      // Delay between requests
      if (i < PRODUCTS_TO_SCRAPE.length - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // Save results
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✓ Found ${found}/${PRODUCTS_TO_SCRAPE.length} products`);
    console.log(`✓ Saved to ${OUTPUT_FILE}`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
