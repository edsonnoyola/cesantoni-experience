const RENDER_API = 'https://cesantoni-experience.onrender.com';

// Mapping rules for product types based on name patterns
function determineType(product) {
  const name = (product.name || '').toUpperCase();
  const category = (product.category || '').toUpperCase();
  const slug = (product.slug || '').toLowerCase();

  // Already has type? Skip
  if (product.type) return null;

  // Mallas are usually standard porcelain
  if (name.includes('MALLA')) {
    return 'PORCELÁNICO';
  }

  // Pavers are rectified
  if (name.includes('PAVER')) {
    return 'PORCELÁNICO RECTIFICADO';
  }

  // Wood-look tiles are typically rectified porcelain
  if (name.includes('WOOD') || category.includes('MADERA') ||
      ['alabama', 'amberwood', 'blendwood', 'cannon-wood', 'elkwood', 'legacy-wood',
       'lightwood', 'merlot-wood', 'riverwood', 'timberland', 'woodland'].some(w => slug.includes(w))) {
    return 'PORCELÁNICO RECTIFICADO';
  }

  // Marble-look tiles
  if (category.includes('MÁRMOL') || category.includes('MARBLE') ||
      ['calacatta', 'bianco', 'carrara', 'statuario', 'botticelli', 'michelino'].some(w => slug.includes(w))) {
    return 'PORCELÁNICO RECTIFICADO';
  }

  // Stone-look tiles
  if (category.includes('PIEDRA') || category.includes('STONE') ||
      ['alpes', 'arezzo', 'britton', 'belmonte', 'dolomitti'].some(w => slug.includes(w))) {
    return 'PORCELÁNICO RECTIFICADO';
  }

  // Cement/concrete look
  if (category.includes('CEMENTO') || category.includes('CONCRETE') ||
      ['cabo', 'harlem', 'domain'].some(w => slug.includes(w))) {
    return 'PORCELÁNICO RECTIFICADO';
  }

  // Large format tiles (60x60 or larger) are typically rectified
  const format = product.format || '';
  if (format.includes('60') || format.includes('80') || format.includes('120') || format.includes('160')) {
    return 'PORCELÁNICO RECTIFICADO';
  }

  // Default to porcelánico rectificado for premium products
  return 'PORCELÁNICO RECTIFICADO';
}

// Determine category if missing
function determineCategory(product) {
  const name = (product.name || '').toUpperCase();
  const slug = (product.slug || '').toLowerCase();

  // Already has a proper category
  if (product.category && product.category !== 'Pisos') return null;

  // Wood patterns
  if (name.includes('WOOD') ||
      ['alabama', 'amberwood', 'blendwood', 'cannon', 'elkwood', 'legacy', 'maple',
       'lightwood', 'merlot', 'riverwood', 'timberland', 'woodland', 'sandwood'].some(w => slug.includes(w))) {
    return 'MADERA';
  }

  // Marble patterns
  if (['calacatta', 'bianco', 'carrara', 'statuario', 'botticelli', 'michelino',
       'bottura', 'magenta', 'quartz'].some(w => slug.includes(w))) {
    return 'MÁRMOL';
  }

  // Stone patterns
  if (['alpes', 'arezzo', 'britton', 'belmonte', 'dolomitti', 'piatra', 'cavour',
       'sardegna', 'valenciano', 'emilia', 'indigo', 'livorno'].some(w => slug.includes(w))) {
    return 'PIEDRA';
  }

  // Cement/industrial
  if (['cabo', 'harlem', 'domain', 'terrazo', 'cemento'].some(w => slug.includes(w))) {
    return 'CEMENTO';
  }

  return null;
}

// Determine uses if missing
function determineUses(product) {
  if (product.uses) return null;

  const name = (product.name || '').toUpperCase();
  const category = (product.category || '').toUpperCase();

  // Exterior suitable products
  if (name.includes('PAVER') || category.includes('PIEDRA') || category.includes('CEMENTO')) {
    return 'INTERIOR, EXTERIOR';
  }

  // Wood look - typically interior only
  if (category.includes('MADERA') || name.includes('WOOD')) {
    return 'INTERIOR, EXTERIOR';
  }

  // Marble - interior focused
  if (category.includes('MÁRMOL')) {
    return 'INTERIOR, BAÑO';
  }

  // Default
  return 'INTERIOR';
}

async function main() {
  console.log('=== Actualizando tipos de productos ===\n');

  // Get all products
  const res = await fetch(`${RENDER_API}/api/products`);
  const products = await res.json();
  console.log(`Total productos: ${products.length}\n`);

  let updated = 0;
  let skipped = 0;

  for (const product of products) {
    const updates = {};

    const newType = determineType(product);
    if (newType) updates.type = newType;

    const newCategory = determineCategory(product);
    if (newCategory) updates.category = newCategory;

    const newUses = determineUses(product);
    if (newUses) updates.uses = newUses;

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    try {
      const updateRes = await fetch(`${RENDER_API}/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (updateRes.ok) {
        console.log(`✓ ${product.name.padEnd(25)} | type: ${updates.type || '-'} | cat: ${updates.category || '-'} | uses: ${updates.uses || '-'}`);
        updated++;
      } else {
        console.log(`✗ ${product.name}: API error`);
      }
    } catch (e) {
      console.log(`✗ ${product.name}: ${e.message}`);
    }

    // Small delay
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Sin cambios: ${skipped}`);
}

main().catch(console.error);
