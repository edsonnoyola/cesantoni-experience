// Re-scrape galleries from cesantoni.com.mx with full image names
const https = require('https');
const { initDB, query, run } = require('../database.js');

async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function extractGalleryImages(html, productName) {
  // Find all image URLs from cesantoni uploads
  const regex = /https:\/\/www\.cesantoni\.com\.mx\/wp-content\/uploads\/[^"'\s>]+\.(jpg|jpeg|png|webp)/gi;
  const matches = html.match(regex) || [];

  // Clean and dedupe
  const seen = new Set();
  const images = [];

  matches.forEach(url => {
    // Clean URL (remove size suffixes for deduplication)
    let cleanUrl = url.replace(/-\d+x\d+\./, '.');

    // Skip logos, icons, small images
    if (url.includes('logo') || url.includes('icon') || url.includes('check_mini') ||
        url.includes('cropped-') || url.includes('thumbs') || url.includes('PEI-') ||
        url.includes('Interior-1') || url.includes('Exterior-1') || url.includes('Bano-1') ||
        url.includes('Cocina-1') || url.includes('-e16') && url.includes('170.jpg')) {
      return;
    }

    // Skip if already seen (by clean URL)
    const baseKey = cleanUrl.split('/').pop().split('.')[0].toLowerCase();
    if (seen.has(baseKey)) return;
    seen.add(baseKey);

    // Prefer larger versions
    const largeUrl = url.replace(/-\d+x\d+\./, '-1024x');
    if (!largeUrl.includes('-1024x')) {
      images.push(url);
    } else {
      // Try to find 1024 version
      const match1024 = matches.find(m => m.includes(baseKey) && m.includes('1024'));
      images.push(match1024 || url);
    }
  });

  // Filter to only product-related images
  const productSlug = productName.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');
  const filtered = images.filter(url => {
    const urlLower = url.toLowerCase();
    // Keep renders and product images
    return urlLower.includes('render') ||
           urlLower.includes(productSlug) ||
           urlLower.includes('vxl_') ||
           urlLower.includes('piso');
  });

  return filtered.length > 0 ? filtered : images.slice(0, 8);
}

async function main() {
  await initDB();

  // Get products with slugs
  const products = query(`SELECT id, name, slug FROM products WHERE slug IS NOT NULL AND slug != ''`);
  console.log(`Found ${products.length} products to scrape\n`);

  let updated = 0;
  let failed = 0;

  for (const product of products) {
    const url = `https://www.cesantoni.com.mx/producto/${product.slug}/`;

    try {
      console.log(`Scraping: ${product.name} (${product.slug})`);
      const html = await fetchPage(url);

      if (html.length < 1000) {
        console.log(`  ❌ Page empty`);
        failed++;
        continue;
      }

      const images = extractGalleryImages(html, product.name);

      if (images.length > 0) {
        // Check for room keywords in images
        const rooms = [];
        images.forEach(img => {
          const lower = img.toLowerCase();
          if (lower.includes('sala') || lower.includes('living') || lower.includes('comedor')) rooms.push('sala');
          if (lower.includes('cocina') || lower.includes('kitchen')) rooms.push('cocina');
          if (lower.includes('bano') || lower.includes('baño') || lower.includes('bath')) rooms.push('baño');
          if (lower.includes('recamara') || lower.includes('bedroom') || lower.includes('habitacion')) rooms.push('recámara');
          if (lower.includes('terraza') || lower.includes('exterior') || lower.includes('patio')) rooms.push('terraza');
        });

        const uniqueRooms = [...new Set(rooms)];

        run(`UPDATE products SET gallery = ? WHERE id = ?`, [JSON.stringify(images), product.id]);
        console.log(`  ✅ ${images.length} images, rooms: ${uniqueRooms.join(', ') || 'ninguno'}`);
        updated++;
      } else {
        console.log(`  ⚠️ No images found`);
        failed++;
      }

      // Small delay to be nice to the server
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
