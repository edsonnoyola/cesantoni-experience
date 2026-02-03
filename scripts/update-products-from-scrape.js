/**
 * Updates the database with scraped product data from cesantoni.com.mx
 */
const { initDB, query, run, saveDB } = require('../database');
const fs = require('fs');
const path = require('path');

const SCRAPED_FILE = path.join(__dirname, '..', 'data', 'scraped-products.json');

async function updateProducts() {
  console.log('Initializing database...');
  await initDB();

  // Load scraped data
  const scrapedProducts = JSON.parse(fs.readFileSync(SCRAPED_FILE, 'utf8'));
  console.log(`Loaded ${scrapedProducts.length} scraped products\n`);

  // First, ensure the new columns exist
  const columnsToAdd = [
    'pei TEXT',
    'official_url TEXT',
    'uses TEXT',
    'gallery TEXT'
  ];

  for (const col of columnsToAdd) {
    const colName = col.split(' ')[0];
    try {
      run(`ALTER TABLE products ADD COLUMN ${col}`);
      console.log(`Added column: ${colName}`);
    } catch (e) {
      // Column already exists
    }
  }

  // Get existing products
  const existingProducts = query('SELECT * FROM products');
  console.log(`Found ${existingProducts.length} existing products in database\n`);

  let updated = 0;
  let added = 0;

  for (const scraped of scrapedProducts) {
    // Clean up the type field (remove newlines)
    const cleanType = (scraped.type || '').replace(/\n/g, ' ').trim();

    // Format uses as comma-separated string
    const usesStr = (scraped.uses || []).join(', ');

    // Filter images to get only product images (not logos or icons)
    const productImages = (scraped.images || []).filter(img =>
      !img.includes('Logo') &&
      !img.includes('logo') &&
      !img.includes('icon') &&
      !img.includes('cropped-Cesantoni_Marcas') &&
      !img.includes('square-60x60') &&
      !img.includes('PEI-') &&
      !img.includes('numero-de-caras') &&
      !img.includes('Exterior-1') &&
      !img.includes('Interior-1')
    );

    // Find matching existing product by name similarity
    const existingProduct = existingProducts.find(p => {
      const pName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const sName = scraped.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return pName.includes(sName) || sName.includes(pName) || pName === sName;
    });

    if (existingProduct) {
      // Update existing product with scraped data
      run(`
        UPDATE products SET
          format = COALESCE(NULLIF(?, ''), format),
          type = COALESCE(NULLIF(?, ''), type),
          finish = COALESCE(NULLIF(?, ''), finish),
          category = COALESCE(NULLIF(?, ''), category),
          image_url = COALESCE(NULLIF(?, ''), image_url),
          pei = ?,
          official_url = ?,
          uses = ?,
          gallery = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        scraped.format || '',
        cleanType,
        scraped.finish || '',
        scraped.category || '',
        productImages[0] || '',
        scraped.pei || '',
        scraped.url || '',
        usesStr,
        JSON.stringify(productImages.slice(0, 5)),
        existingProduct.id
      ]);
      console.log(`✓ Updated: ${existingProduct.name} <- ${scraped.name}`);
      updated++;
    } else {
      // Create new SKU from name
      const newSku = scraped.sku || scraped.name.toUpperCase()
        .replace(/[^A-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 20);

      // Add new product
      try {
        run(`
          INSERT INTO products (sku, name, format, type, finish, category, image_url, pei, official_url, uses, gallery, active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          newSku,
          scraped.name,
          scraped.format || '',
          cleanType,
          scraped.finish || '',
          scraped.category || '',
          productImages[0] || '',
          scraped.pei || '',
          scraped.url || '',
          usesStr,
          JSON.stringify(productImages.slice(0, 5))
        ]);
        console.log(`+ Added: ${scraped.name} (${newSku})`);
        added++;
      } catch (e) {
        console.log(`  Skip duplicate: ${scraped.name}`);
      }
    }
  }

  saveDB();
  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated} products`);
  console.log(`Added: ${added} new products`);
  console.log(`Total in DB: ${query('SELECT COUNT(*) as c FROM products')[0].c}`);
}

updateProducts().catch(console.error);
