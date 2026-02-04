// Fix formats - extract real tile formats, not image dimensions
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

// Real tile format dimensions (common Cesantoni sizes)
const validFormats = [
  '20x120', '26x160', '60x60', '60x120', '80x80', '80x160',
  '30x60', '30x30', '45x45', '45x90', '15x90', '22x90',
  '59x59', '59x119', '75x75', '100x100', '120x120', '120x260'
];

function extractFormat(html) {
  // Look for valid tile formats
  for (const format of validFormats) {
    const [w, h] = format.split('x');
    const patterns = [
      new RegExp(`${w}\\s*[xX×]\\s*${h}`, 'gi'),
      new RegExp(`${w}x${h}`, 'gi'),
      new RegExp(`formato.*${w}.*${h}`, 'gi')
    ];

    for (const pattern of patterns) {
      if (pattern.test(html)) {
        return `${w} x ${h} cm`;
      }
    }
  }

  // Fallback: try to find any format mentioned with "cm"
  const cmPattern = /(\d{2,3})\s*[xX×]\s*(\d{2,3})\s*cm/gi;
  const matches = html.match(cmPattern);
  if (matches && matches.length > 0) {
    const clean = matches[0].replace(/[xX×]/g, ' x ').replace(/\s+/g, ' ');
    return clean;
  }

  return null;
}

async function main() {
  await initDB();

  // Get products with wrong format (59x88)
  const products = query(`SELECT id, name, slug, format FROM products WHERE slug IS NOT NULL AND (format LIKE '%59%88%' OR format IS NULL)`);
  console.log(`Fixing ${products.length} products with wrong format...\n`);

  let fixed = 0;

  for (const p of products) {

    const url = `https://www.cesantoni.com.mx/producto/${p.slug}/`;

    try {
      process.stdout.write(`${p.name}...`);
      const html = await fetchPage(url);

      if (html.length < 1000) {
        console.log(' (page not found)');
        continue;
      }

      const format = extractFormat(html);
      if (format && format !== '59 x 88 cm') {
        run(`UPDATE products SET format = ? WHERE id = ?`, [format, p.id]);
        console.log(` ✅ ${format}`);
        fixed++;
      } else {
        console.log(` (no valid format found)`);
      }

      await new Promise(r => setTimeout(r, 150));

    } catch (err) {
      console.log(` ❌ ${err.message}`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Formats fixed: ${fixed}`);
}

main().catch(console.error);
