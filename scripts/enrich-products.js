// Enrich products: scrape formats and improve small galleries
const https = require('https');
const { initDB, query, run } = require('../database.js');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function extractFormat(html) {
  // Look for format patterns like "60x60", "26x160", "80x160"
  const formatPatterns = [
    /(\d{2,3}\s*[xX×]\s*\d{2,3})\s*(cm)?/gi,
    /formato[:\s]+(\d{2,3}\s*[xX×]\s*\d{2,3})/gi,
    /(\d{2,3}[xX×]\d{2,3})\s*cm/gi
  ];

  for (const pattern of formatPatterns) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      // Clean and normalize
      let format = matches[0].replace(/[xX×]/g, 'x').replace(/\s+/g, '').toLowerCase();
      // Add "cm" if not present
      if (!format.includes('cm')) format += ' cm';
      else format = format.replace('cm', ' cm');
      // Capitalize properly
      format = format.replace(/(\d+)x(\d+)/, '$1 x $2');
      return format;
    }
  }
  return null;
}

function extractGalleryImages(html, productName) {
  const regex = /https:\/\/www\.cesantoni\.com\.mx\/wp-content\/uploads\/[^"'\s>]+\.(jpg|jpeg|png|webp)/gi;
  const matches = html.match(regex) || [];

  const seen = new Set();
  const images = [];
  const productSlug = productName.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');

  matches.forEach(url => {
    const fileName = url.toLowerCase().split('/').pop();
    const baseName = fileName.replace(/-\d+x\d+/, '').replace(/\.(jpg|jpeg|png|webp)$/, '');

    // Skip duplicates, logos, icons
    if (seen.has(baseName)) return;
    if (fileName.includes('logo') || fileName.includes('icon') || fileName.includes('cropped-')) return;
    if (fileName.includes('pei-') || fileName.includes('interior-1') || fileName.includes('exterior-1')) return;

    // Must be related to product
    const hasProductRef = fileName.includes(productSlug) ||
                         fileName.includes(productName.split(' ')[0].toLowerCase()) ||
                         fileName.includes('render') || fileName.includes('vxl');

    if (hasProductRef) {
      seen.add(baseName);
      // Prefer larger versions
      const cleanUrl = url.includes('-1024x') ? url : url.replace(/-\d+x\d+\./, '-1024x1024.');
      images.push(url);
    }
  });

  return images;
}

async function main() {
  await initDB();

  // Get all products
  const products = query(`SELECT id, name, slug, format, gallery FROM products WHERE slug IS NOT NULL`);
  console.log(`Processing ${products.length} products...\n`);

  let formatsUpdated = 0;
  let galleriesUpdated = 0;

  for (const p of products) {
    const needsFormat = !p.format;
    let gallery = [];
    try { gallery = JSON.parse(p.gallery) || []; } catch(e) {}
    const needsGallery = gallery.length < 3;

    if (!needsFormat && !needsGallery) continue;

    const url = `https://www.cesantoni.com.mx/producto/${p.slug}/`;

    try {
      process.stdout.write(`${p.name}...`);
      const html = await fetchPage(url);

      if (html.length < 1000) {
        console.log(' ❌ page not found');
        continue;
      }

      let updates = [];

      // Extract format
      if (needsFormat) {
        const format = extractFormat(html);
        if (format) {
          run(`UPDATE products SET format = ? WHERE id = ?`, [format, p.id]);
          updates.push(`format: ${format}`);
          formatsUpdated++;
        }
      }

      // Enrich gallery
      if (needsGallery) {
        const newImages = extractGalleryImages(html, p.name);
        if (newImages.length > gallery.length) {
          // Merge with existing, remove duplicates
          const merged = [...new Set([...gallery, ...newImages])];
          run(`UPDATE products SET gallery = ? WHERE id = ?`, [JSON.stringify(merged), p.id]);
          updates.push(`gallery: ${gallery.length} -> ${merged.length}`);
          galleriesUpdated++;
        }
      }

      if (updates.length > 0) {
        console.log(` ✅ ${updates.join(', ')}`);
      } else {
        console.log(' (no changes)');
      }

      // Be nice to server
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      console.log(` ❌ ${err.message}`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Formats updated: ${formatsUpdated}`);
  console.log(`Galleries enriched: ${galleriesUpdated}`);
}

main().catch(console.error);
