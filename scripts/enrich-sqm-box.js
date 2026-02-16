#!/usr/bin/env node
/**
 * Enrich products with sqm_per_box from cesantoni.com.mx
 * Scrapes the #producto-m2-caja repeater element from product pages
 * Falls back to industry-standard calculations by format
 */

const BASE = 'https://cesantoni-experience-za74.onrender.com';
const CESANTONI = 'https://www.cesantoni.com.mx';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scrape(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 CesantoniBot/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function extractM2Caja(html, targetFormat) {
  // Pattern: <div class="repeater-item ...">FORMAT</div><span class="repeater-item ...">M2VALUE</span>
  const m2Section = html.match(/id="producto-m2-caja"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  if (!m2Section) return null;

  const pairs = [];
  const regex = /<div class="repeater-item[^"]*">([^<]+)<\/div><span class="repeater-item[^"]*">([^<]+)<\/span>/g;
  let match;
  while ((match = regex.exec(m2Section[0])) !== null) {
    pairs.push({ format: match[1].trim(), m2: parseFloat(match[2].trim()) });
  }

  if (pairs.length === 0) return null;

  // Try to match the target format
  if (targetFormat) {
    const normalizedTarget = targetFormat.toLowerCase().replace(/\s+/g, '').replace('x', 'x');
    for (const p of pairs) {
      const normalizedFmt = p.format.toLowerCase().replace(/\s+/g, '').replace('x', 'x');
      if (normalizedFmt === normalizedTarget || normalizedTarget.includes(normalizedFmt) || normalizedFmt.includes(normalizedTarget)) {
        return p;
      }
    }
    // Try matching just the numbers
    const targetNums = targetFormat.match(/\d+/g)?.join('x');
    for (const p of pairs) {
      const fmtNums = p.format.match(/\d+/g)?.join('x');
      if (targetNums === fmtNums) return p;
    }
  }

  // Return first if only one
  if (pairs.length === 1) return pairs[0];
  return pairs[0]; // Default to first format
}

// Calculate pieces from format and m2/box
function calcPieces(format, m2PerBox) {
  if (!format || !m2PerBox) return null;
  const nums = format.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!nums) return null;
  const w = parseFloat(nums[1]) / 100; // cm to m
  const h = parseFloat(nums[2]) / 100;
  const areaPerPiece = w * h;
  if (areaPerPiece <= 0) return null;
  return Math.round(m2PerBox / areaPerPiece);
}

// Fallback: estimate m2/box from format using Cesantoni standards
function estimateM2(format) {
  if (!format) return null;
  const nums = format.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!nums) return null;
  const w = parseFloat(nums[1]);
  const h = parseFloat(nums[2]);
  const key = `${Math.min(w,h)}x${Math.max(w,h)}`;

  // Known Cesantoni packaging (scraped from site)
  const KNOWN = {
    '20x120': { m2: 1.44, pcs: 6 },   // 6 pcs * 0.2*1.2 = 1.44
    '20x160': { m2: 1.60, pcs: 5 },   // 5 pcs * 0.2*1.6 = 1.60
    '26x160': { m2: 1.664, pcs: 4 },  // 4 pcs * 0.26*1.6 = 1.664
    '60x120': { m2: 1.44, pcs: 2 },   // 2 pcs * 0.6*1.2 = 1.44
    '60x60': { m2: 1.44, pcs: 4 },    // 4 pcs * 0.6*0.6 = 1.44
    '61x61': { m2: 1.49, pcs: 4 },    // 4 pcs * 0.61*0.61
    '80x160': { m2: 1.28, pcs: 1 },   // 1 pc * 0.8*1.6 = 1.28
    '30x60': { m2: 1.08, pcs: 6 },    // 6 pcs * 0.3*0.6 = 1.08
    '30x75': { m2: 1.35, pcs: 6 },    // 6 pcs * 0.3*0.75
    '45x90': { m2: 1.62, pcs: 4 },    // 4 pcs * 0.45*0.9
    '30x30': { m2: 0.99, pcs: 11 },   // 11 pcs * 0.3*0.3
    '5x30': { m2: 0.54, pcs: 36 },    // mosaico
    '5x58': { m2: 0.58, pcs: 20 },    // listello
    '20x60': { m2: 1.08, pcs: 9 },    // 9 pcs * 0.2*0.6
  };

  if (KNOWN[key]) return KNOWN[key];
  return null;
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
  console.log('=== ENRICH sqm_per_box + pieces_per_box ===\n');

  const products = await (await fetch(`${BASE}/api/products`)).json();
  console.log(`${products.length} products total\n`);

  let scraped = 0, estimated = 0, failed = 0;

  // First pass: scrape from cesantoni.com.mx for products with official_url
  const withUrl = products.filter(p => p.official_url);
  const withoutUrl = products.filter(p => !p.official_url);

  console.log(`--- Phase 1: Scraping ${withUrl.length} products with official URLs ---\n`);

  const scrapedData = {}; // format -> m2 mapping from scraping

  for (const p of withUrl) {
    const url = p.official_url;
    process.stdout.write(`[${p.id}] ${p.name.padEnd(22)} `);

    const html = await scrape(url);
    if (!html || html.length < 1000) {
      console.log('PAGE FAILED');
      failed++;
      await sleep(200);
      continue;
    }

    const result = extractM2Caja(html, p.format);
    if (result && result.m2 > 0) {
      const pieces = calcPieces(p.format, result.m2);
      const updates = { sqm_per_box: result.m2 };
      if (pieces) updates.pieces_per_box = pieces;

      const ok = await updateProduct(p.id, updates);
      console.log(ok ? `✓ ${result.format} → ${result.m2} m²/caja, ${pieces || '?'} pcs` : 'API ERROR');

      // Store for format-based fallback
      const fmtKey = (p.format || '').match(/\d+/g)?.join('x');
      if (fmtKey) scrapedData[fmtKey] = { m2: result.m2, pcs: pieces };
      scraped++;
    } else {
      console.log('NO M2 DATA IN PAGE');
      failed++;
    }

    await sleep(300);
  }

  console.log(`\n--- Phase 2: ${withoutUrl.length} products without URLs (format-based) ---\n`);

  for (const p of withoutUrl) {
    process.stdout.write(`[${p.id}] ${p.name.padEnd(22)} `);

    // First try slug-based URL
    const slug = (p.slug || p.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    let result = null;

    if (slug) {
      const testUrl = `${CESANTONI}/producto/${slug}/`;
      const html = await scrape(testUrl);
      if (html && html.length > 1000) {
        result = extractM2Caja(html, p.format);
        if (result && result.m2 > 0) {
          const pieces = calcPieces(p.format, result.m2);
          const updates = { sqm_per_box: result.m2 };
          if (pieces) updates.pieces_per_box = pieces;

          const ok = await updateProduct(p.id, updates);
          console.log(ok ? `✓ SCRAPED ${slug} → ${result.m2} m²/caja, ${pieces || '?'} pcs` : 'API ERROR');

          const fmtKey = (p.format || '').match(/\d+/g)?.join('x');
          if (fmtKey) scrapedData[fmtKey] = { m2: result.m2, pcs: pieces };
          scraped++;
          await sleep(300);
          continue;
        }
      }
    }

    // Fallback: use scraped data for same format
    const fmtKey = (p.format || '').match(/\d+/g)?.join('x');
    const fromScraped = fmtKey ? scrapedData[fmtKey] : null;
    const fromKnown = estimateM2(p.format);
    const fallback = fromScraped || fromKnown;

    if (fallback) {
      const updates = { sqm_per_box: fallback.m2 };
      if (fallback.pcs) updates.pieces_per_box = fallback.pcs;

      const ok = await updateProduct(p.id, updates);
      const source = fromScraped ? 'MATCHED' : 'ESTIMATED';
      console.log(ok ? `≈ ${source} ${fmtKey} → ${fallback.m2} m²/caja, ${fallback.pcs || '?'} pcs` : 'API ERROR');
      estimated++;
    } else {
      console.log(`✗ NO FORMAT MATCH (${p.format || 'unknown'})`);
      failed++;
    }

    await sleep(100);
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Scraped from site: ${scraped}`);
  console.log(`Estimated by format: ${estimated}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${products.length}`);

  // Verify
  console.log('\n=== VERIFICATION ===');
  const updated = await (await fetch(`${BASE}/api/products`)).json();
  const withSqm = updated.filter(p => p.sqm_per_box > 0).length;
  const withPcs = updated.filter(p => p.pieces_per_box > 0).length;
  console.log(`sqm_per_box: ${withSqm}/${updated.length}`);
  console.log(`pieces_per_box: ${withPcs}/${updated.length}`);
}

main().catch(console.error);
