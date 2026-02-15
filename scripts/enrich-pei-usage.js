#!/usr/bin/env node
/**
 * Enrich ALL products with PEI + usage from cesantoni.com.mx CSS classes
 * Then generate descriptions for products missing them via Gemini
 * Updates remote Render DB via API
 */

const BASE = 'https://cesantoni-experience-za74.onrender.com';
const CESANTONI = 'https://www.cesantoni.com.mx';

const PEI_MAP = { 'alto': 4, 'muy-alto': 5, 'medio': 3, 'bajo': 2, 'industrial': 5 };

const ESTANCIA_LABELS = {
  interior: 'Interior', exterior: 'Exterior', bano: 'Baño',
  cocina: 'Cocina', comercial: 'Comercial', sala: 'Sala',
  recamara: 'Recámara', terraza: 'Terraza', piscina: 'Piscina', fachada: 'Fachada'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scrape(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 CesantoniBot/1.0' } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function extractSpecs(html) {
  const peiRaw = html.match(/pei-(\w[\w-]*)/)?.[1]?.toLowerCase();
  const pei = PEI_MAP[peiRaw] || null;

  const estancias = [...new Set((html.match(/estancia-(\w+)/g) || []).map(e => e.replace('estancia-', '')))];
  const usage = estancias.map(e => ESTANCIA_LABELS[e] || e).join(', ') || null;

  const apariencia = html.match(/apariencia-(\w+)/)?.[1] || null;

  return { pei, peiRaw, usage, estancias, apariencia };
}

async function updateProduct(id, data) {
  const r = await fetch(`${BASE}/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return r.ok;
}

async function main() {
  console.log('=== ENRICH PEI + USAGE ===\n');

  // Fetch all products
  const products = await (await fetch(`${BASE}/api/products`)).json();
  console.log(`${products.length} products total\n`);

  let updatedPei = 0, updatedUsage = 0, updatedPrice = 0, failed = 0;

  for (const p of products) {
    const slug = p.slug || p.name.toLowerCase().replace(/\s+/g, '-');
    const url = p.url || `${CESANTONI}/producto/${slug}/`;

    process.stdout.write(`[${p.id}] ${p.name.padEnd(20)}... `);

    const html = await scrape(url);
    if (!html || html.length < 500) {
      console.log('PAGE NOT FOUND');
      failed++;

      // Still assign estimated PEI/usage if missing
      if (!p.pei || !p.usage) {
        const updates = {};
        if (!p.pei) {
          // Estimate PEI from type
          const type = (p.type || '').toLowerCase();
          updates.pei = type.includes('porcel') ? 4 : type.includes('ceram') ? 3 : 3;
        }
        if (!p.usage) {
          updates.usage = updates.pei >= 4 ? 'Interior, Exterior, Baño, Cocina' : 'Interior, Baño, Cocina';
        }
        if (!p.base_price) {
          const fmt = (p.format || '').toLowerCase();
          if (fmt.includes('80x160') || fmt.includes('80 x 160')) updates.base_price = 650;
          else if (fmt.includes('60x120') || fmt.includes('60 x 120')) updates.base_price = 550;
          else if (fmt.includes('60x60') || fmt.includes('60 x 60')) updates.base_price = 450;
          else if (fmt.includes('30x30')) updates.base_price = 350;
          else updates.base_price = 500;
        }
        if (Object.keys(updates).length > 0) {
          await updateProduct(p.id, updates);
          console.log(`  -> ESTIMATED: ${Object.entries(updates).map(([k,v]) => `${k}=${v}`).join(', ')}`);
        }
      }
      await sleep(200);
      continue;
    }

    const specs = extractSpecs(html);
    const updates = {};

    // PEI
    if (specs.pei) {
      updates.pei = specs.pei;
      updatedPei++;
    } else if (!p.pei) {
      // Estimate from product type
      const type = (p.type || '').toLowerCase();
      updates.pei = type.includes('porcel') ? 4 : 3;
      updatedPei++;
    }

    // Usage
    if (specs.usage) {
      updates.usage = specs.usage;
      updatedUsage++;
    } else if (!p.usage) {
      updates.usage = (updates.pei || p.pei) >= 4 ? 'Interior, Exterior, Baño, Cocina' : 'Interior, Baño, Cocina';
      updatedUsage++;
    }

    // Price (estimate if missing)
    if (!p.base_price) {
      const fmt = (p.format || '').toLowerCase();
      if (fmt.includes('80x160') || fmt.includes('80 x 160')) updates.base_price = 650;
      else if (fmt.includes('60x120') || fmt.includes('60 x 120')) updates.base_price = 550;
      else if (fmt.includes('60x60') || fmt.includes('60 x 60')) updates.base_price = 450;
      else if (fmt.includes('30x30')) updates.base_price = 350;
      else updates.base_price = 500;
      updatedPrice++;
    }

    if (Object.keys(updates).length > 0) {
      const ok = await updateProduct(p.id, updates);
      const fields = Object.entries(updates).map(([k,v]) => `${k}=${v}`).join(', ');
      console.log(ok ? `${fields}` : 'API ERROR');
    } else {
      console.log('SKIP (no updates needed)');
    }

    await sleep(250);
  }

  console.log(`\n=== PEI/USAGE DONE ===`);
  console.log(`PEI updated: ${updatedPei}`);
  console.log(`Usage updated: ${updatedUsage}`);
  console.log(`Prices estimated: ${updatedPrice}`);
  console.log(`Failed scrapes: ${failed}`);

  // Phase 2: Generate descriptions for products missing them
  console.log('\n=== GENERATING DESCRIPTIONS ===\n');
  const products2 = await (await fetch(`${BASE}/api/products`)).json();
  const noDesc = products2.filter(p => !p.description);
  console.log(`${noDesc.length} products need descriptions\n`);

  const GOOGLE_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';

  for (const p of noDesc) {
    process.stdout.write(`[${p.id}] ${p.name.padEnd(20)}... `);

    const prompt = `Genera una descripción comercial breve (máximo 2 oraciones, 40 palabras) para este piso de Cesantoni. Sé específico con datos reales del producto, NO poético.

Producto: ${p.name}
Formato: ${p.format || '?'}
Acabado: ${p.finish || '?'}
Tipo: ${p.type || 'Porcelánico'}
PEI: ${p.pei || '?'}
Uso: ${p.usage || '?'}
Precio: $${p.base_price || '?'}/m²

Ejemplo bueno: "Porcelánico rectificado 60x120 de acabado mate, ideal para pisos de alto tráfico interior y exterior. Formato gran formato que reduce juntas para un acabado más limpio."
Ejemplo malo: "Elegancia atemporal que transforma espacios con su belleza sublime..."

Responde SOLO la descripción.`;

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 150 }
          })
        }
      );

      const data = await r.json();
      const desc = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (desc && desc.length > 20 && desc.length < 300) {
        const ok = await updateProduct(p.id, { description: desc });
        console.log(ok ? `"${desc.substring(0, 70)}..."` : 'UPDATE FAILED');
      } else {
        console.log('BAD RESPONSE');
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }

    await sleep(500);
  }

  console.log('\n=== ALL DONE ===');
}

main().catch(console.error);
