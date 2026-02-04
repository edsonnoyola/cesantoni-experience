// Clean galleries - remove images from other products
const { initDB, query, run } = require('../database.js');

const otherProductNames = [
  'memphis', 'amberwood', 'nebraska', 'decker', 'alabama', 'blendwood',
  'bento', 'britton', 'harlow', 'woodland', 'timberland', 'sereni',
  'riverwood', 'nekk', 'mylo', 'lightwood', 'lemek', 'hanover',
  'fiore', 'denver', 'cannon', 'caravita', 'cotto', 'harlem',
  'legacy', 'sandwood', 'merlot', 'napoli', 'riviera', 'samperi',
  'stockton', 'sunset', 'terrazo', 'vermont', 'maple', 'quarzo',
  'bianco', 'romagni', 'cabo', 'fiorentino', 'sterling', 'mutina',
  'casablanca', 'piatra', 'giardino', 'botticelli', 'verttoni',
  'mazarello', 'mare', 'bottura', 'celle', 'domain', 'fontana',
  'piave', 'kampala', 'pangea', 'livia', 'coral', 'silverstone',
  'bastille', 'marconi', 'calacatta', 'nobu', 'kingston', 'belmonte',
  'ravelo', 'peninsula', 'oxford'
];

async function main() {
  await initDB();

  const products = query(`SELECT id, name, slug, gallery FROM products WHERE gallery IS NOT NULL`);
  console.log(`Checking ${products.length} products...\n`);

  let cleaned = 0;
  let totalRemoved = 0;

  for (const p of products) {
    let gallery = [];
    try {
      gallery = JSON.parse(p.gallery);
    } catch(e) { continue; }

    if (!gallery.length) continue;

    const productSlug = (p.slug || '').toLowerCase().replace(/-/g, '');
    const productName = p.name.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');
    const productWords = p.name.toLowerCase().split(/\s+/);

    // Filter out images from other products
    const cleanGallery = gallery.filter(url => {
      const fileName = url.toLowerCase().split('/').pop();

      // Check if this image belongs to another product
      for (const other of otherProductNames) {
        // Skip if this IS the current product
        if (productSlug.includes(other) || productName.includes(other) ||
            productWords.some(w => w.includes(other) || other.includes(w))) {
          continue;
        }

        // If filename contains another product name, exclude it
        if (fileName.includes(other)) {
          return false;
        }
      }

      return true;
    });

    const removed = gallery.length - cleanGallery.length;

    if (removed > 0) {
      run(`UPDATE products SET gallery = ? WHERE id = ?`, [JSON.stringify(cleanGallery), p.id]);
      console.log(`${p.name}: removed ${removed} foreign images (${gallery.length} -> ${cleanGallery.length})`);
      cleaned++;
      totalRemoved += removed;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Products cleaned: ${cleaned}`);
  console.log(`Total images removed: ${totalRemoved}`);
}

main().catch(console.error);
