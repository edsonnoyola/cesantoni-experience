// Deep clean galleries - remove duplicates and foreign product images
const { initDB, query, run } = require('../database.js');

// All product names/slugs to detect foreign images
const allProductNames = [
  'alabama', 'amberwood', 'andrea', 'aranza', 'ardem', 'astor', 'atis',
  'alpes', 'arezzo', 'bastille', 'bento', 'blendwood', 'botev', 'britton',
  'belmonte', 'bianco', 'botticelli', 'bottura', 'calajan', 'cannon', 'casablanca',
  'charlot', 'coral', 'cuori', 'calacatta', 'cavour', 'celle', 'cotto',
  'daytona', 'decker', 'denver', 'dolomitti', 'domain', 'edimburgo', 'elkwood',
  'emilia', 'fiore', 'frau', 'fiorentino', 'fontana', 'gaudi', 'giardino',
  'hanover', 'harlow', 'helsinki', 'harlem', 'indigo', 'kiel', 'kampala',
  'kingston', 'lanz', 'leighton', 'lemek', 'lightwood', 'livia', 'legacy',
  'livorno', 'marconi', 'martel', 'memphis', 'milena', 'moncler', 'monte',
  'montebello', 'mylo', 'mare', 'mazarello', 'merlot', 'michelino', 'napa',
  'nebraska', 'nekk', 'nouvelle', 'nobu', 'piamont', 'piatra', 'pangea',
  'peninsula', 'piave', 'quarzo', 'riverwood', 'ravelo', 'riviera', 'romagni',
  'samperi', 'santo', 'silverstone', 'stockton', 'sardegna', 'sterling',
  'sunset', 'maple', 'terrazo', 'timberland', 'travali', 'trenton', 'valenzi',
  'vermont', 'volterra', 'valenciano', 'verttoni', 'woodland', 'zadar',
  'veleta', 'cabo', 'sandwood', 'carrollton', 'sereni', 'mutina', 'napoli',
  'santorini', 'pitra', 'blenwood'
];

function getBaseName(url) {
  let name = url.split('/').pop().toLowerCase();
  // Remove extension
  name = name.replace(/\.(jpg|jpeg|png|webp)$/, '');
  // Remove all resolution/size suffixes
  name = name.replace(/-scaled$/, '');
  name = name.replace(/-?\d{3,4}x\d{3,4}$/, '');
  name = name.replace(/-e\d{10,}$/, ''); // timestamps
  name = name.replace(/-e\d{10,}-\d+x\d+$/, '');
  name = name.replace(/[-_]\d+$/, ''); // trailing numbers like _1, -1
  // Remove common prefixes
  name = name.replace(/^render_+/i, '');
  name = name.replace(/^vxl_?\d*_?ld_?/i, '');
  name = name.replace(/^vxlab_?\d*_?/i, '');
  name = name.replace(/^porcelanato_?/i, '');
  name = name.replace(/^cesantoni_?/i, '');
  name = name.replace(/^piedra_porcelanica_?/i, '');
  name = name.replace(/^cemento_?/i, '');
  name = name.replace(/^piso[-_]?/i, '');
  return name;
}

function isFromOtherProduct(url, currentProductSlug, currentProductName) {
  const urlLower = url.toLowerCase();
  const fileName = urlLower.split('/').pop();

  const currentSlug = (currentProductSlug || '').toLowerCase().replace(/-/g, '');
  const currentName = (currentProductName || '').toLowerCase().replace(/\s+/g, '');
  const currentWords = (currentProductName || '').toLowerCase().split(/\s+/);

  // Check if URL contains another product name but NOT the current product
  for (const otherProduct of allProductNames) {
    if (fileName.includes(otherProduct)) {
      // Check if it's NOT our product
      const isCurrentProduct =
        currentSlug.includes(otherProduct) ||
        currentName.includes(otherProduct) ||
        currentWords.some(w => w === otherProduct);

      if (!isCurrentProduct) {
        return otherProduct; // Return which product it belongs to
      }
    }
  }
  return null;
}

async function main() {
  await initDB();

  const products = query(`SELECT id, name, slug, gallery FROM products WHERE gallery IS NOT NULL`);
  console.log(`Checking ${products.length} products...\n`);

  let totalRemoved = 0;
  let productsFixed = 0;

  for (const p of products) {
    let gallery;
    try {
      gallery = JSON.parse(p.gallery);
    } catch (e) {
      continue;
    }

    if (!gallery || gallery.length === 0) continue;

    const seenBases = new Set();
    const cleanGallery = [];
    const removed = [];

    for (const url of gallery) {
      const baseName = getBaseName(url);

      // Check for duplicate
      if (seenBases.has(baseName)) {
        removed.push({ url, reason: 'duplicate: ' + baseName });
        continue;
      }

      // Check for foreign product
      const foreignProduct = isFromOtherProduct(url, p.slug, p.name);
      if (foreignProduct) {
        removed.push({ url, reason: 'belongs to: ' + foreignProduct });
        continue;
      }

      seenBases.add(baseName);
      cleanGallery.push(url);
    }

    if (removed.length > 0) {
      console.log(`${p.name}:`);
      removed.forEach(r => {
        const fileName = r.url.split('/').pop();
        console.log(`  ❌ ${fileName.substring(0, 50)}... (${r.reason})`);
      });
      console.log(`  → ${gallery.length} → ${cleanGallery.length} imágenes\n`);

      run(`UPDATE products SET gallery = ? WHERE id = ?`, [JSON.stringify(cleanGallery), p.id]);
      totalRemoved += removed.length;
      productsFixed++;
    }
  }

  console.log('═══════════════════════════════════════');
  console.log(`Total: ${totalRemoved} imágenes eliminadas de ${productsFixed} productos`);
}

main();
