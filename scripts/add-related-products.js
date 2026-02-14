const RENDER_API = 'https://cesantoni-experience-za74.onrender.com';

async function main() {
  console.log('=== Agregando productos relacionados ===\n');

  // Get all products
  const res = await fetch(`${RENDER_API}/api/products`);
  const products = await res.json();

  // Build lookup maps
  const byCategory = {};
  const bySlug = {};

  products.forEach(p => {
    const cat = (p.category || 'Pisos').toUpperCase();
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
    if (p.slug) bySlug[p.slug] = p;
  });

  console.log('Categorías encontradas:');
  Object.entries(byCategory).forEach(([cat, prods]) => {
    console.log(`  ${cat}: ${prods.length} productos`);
  });
  console.log('');

  // Find products without related_products
  const needsRelated = products.filter(p => {
    if (!p.related_products) return true;
    if (p.related_products === '[]') return true;
    if (p.related_products === 'null') return true;
    try {
      const parsed = JSON.parse(p.related_products);
      return !parsed || parsed.length === 0;
    } catch {
      return true;
    }
  });

  console.log(`Productos sin related: ${needsRelated.length}\n`);

  let updated = 0;

  for (const product of needsRelated) {
    const cat = (product.category || 'Pisos').toUpperCase();
    const sameCat = byCategory[cat] || byCategory['PISOS'] || [];

    // Find 4 related products from same category (excluding self)
    const related = sameCat
      .filter(p => p.id !== product.id && p.slug)
      .slice(0, 4)
      .map(p => p.slug);

    if (related.length === 0) continue;

    try {
      const updateRes = await fetch(`${RENDER_API}/api/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ related_products: JSON.stringify(related) })
      });

      if (updateRes.ok) {
        console.log(`✓ ${product.name.padEnd(25)} → ${related.join(', ')}`);
        updated++;
      }
    } catch (e) {
      console.log(`✗ ${product.name}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`Actualizados: ${updated}`);
}

main().catch(console.error);
