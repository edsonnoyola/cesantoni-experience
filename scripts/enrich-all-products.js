const puppeteer = require('puppeteer');

const RENDER_API = 'https://cesantoni-experience-za74.onrender.com';

async function scrapeProduct(browser, slug) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  try {
    await page.goto(`https://www.cesantoni.com.mx/producto/${slug}/`, {
      waitUntil: 'networkidle2',
      timeout: 20000
    });
    await new Promise(r => setTimeout(r, 1000));

    const data = await page.evaluate((currentSlug) => {
      const result = { found: true, images: [], relatedSlugs: [] };

      // Check if 404
      const bodyText = document.body.innerText;
      if (bodyText.includes('página no existe') || bodyText.includes('Page not found') || bodyText.includes('404')) {
        result.found = false;
        return result;
      }

      // Get images - prefer high quality renders
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.dataset.src;
        if (src &&
            src.includes('cesantoni.com.mx') &&
            src.includes('/uploads/') &&
            (src.includes('1024') || src.includes('2048') || src.includes('scaled')) &&
            !src.includes('logo') && !src.includes('Logo') &&
            !src.includes('icon') && !src.includes('PEI') &&
            !src.includes('square-') && !src.includes('numero-de-caras') &&
            !src.includes('Interior-1') && !src.includes('Exterior-1') &&
            !src.includes('Bano-1') && !src.includes('Cocina-1') &&
            !src.includes('cropped-') && !src.includes('thumbs') &&
            !src.includes('sombra')) {
          const clean = src.split('?')[0];
          if (!result.images.includes(clean)) {
            result.images.push(clean);
          }
        }
      });

      // Get related products
      document.querySelectorAll('a[href*="/producto/"]').forEach(link => {
        const m = link.href.match(/\/producto\/([^\/\?#]+)/);
        if (m && m[1]) {
          const rel = m[1].toLowerCase();
          if (rel !== currentSlug && !link.href.includes('/en/') && !result.relatedSlugs.includes(rel)) {
            result.relatedSlugs.push(rel);
          }
        }
      });

      return result;
    }, slug);

    await page.close();
    return data;
  } catch (e) {
    await page.close();
    return { found: false, error: e.message };
  }
}

async function updateProduct(id, data) {
  try {
    const res = await fetch(`${RENDER_API}/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('=== Enriqueciendo TODOS los productos ===\n');

  // Get all products from Render
  console.log('Obteniendo productos de Render...');
  const res = await fetch(`${RENDER_API}/api/products`);
  const products = await res.json();
  console.log(`Found ${products.length} products\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  try {
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const slug = product.slug;

      if (!slug) {
        console.log(`[${i + 1}/${products.length}] ${product.name}: no slug`);
        continue;
      }

      process.stdout.write(`[${i + 1}/${products.length}] ${product.name.substring(0, 20).padEnd(20)} `);

      const scraped = await scrapeProduct(browser, slug);

      if (scraped.found && scraped.images.length > 0) {
        const updateData = {};

        // Update main image if we found a better one
        if (scraped.images.length > 0) {
          updateData.image_url = scraped.images[0];
          updateData.gallery = JSON.stringify(scraped.images.slice(0, 6));
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
          errors++;
        }
      } else {
        console.log(`- not found on cesantoni.com.mx`);
        notFound++;
      }

      // Small delay to avoid overwhelming the server
      await new Promise(r => setTimeout(r, 400));
    }
  } finally {
    await browser.close();
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Actualizados: ${updated}`);
  console.log(`No encontrados: ${notFound}`);
  console.log(`Errores: ${errors}`);
  console.log(`Total: ${products.length}`);
}

main().catch(console.error);
