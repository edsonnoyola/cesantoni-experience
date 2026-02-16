#!/usr/bin/env node
/**
 * Geocode all stores using OpenStreetMap Nominatim (free, no API key)
 * Uses the REST API to read/update stores (avoids direct PG connection issues)
 * Rate limited to 1 req/sec per Nominatim usage policy
 */

const BASE = process.env.API_URL || 'https://cesantoni-experience-za74.onrender.com';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'CesantoniCRM/1.0 (geocoding stores)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanAddress(address) {
  if (!address) return '';
  return address
    .replace(/C\.?P\.?\s*\d{4,5}/gi, '')
    .replace(/#\s*\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function geocode(queryStr) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(queryStr)}&format=json&limit=1&countrycodes=mx`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  } catch { return null; }
}

async function updateStore(id, lat, lng) {
  const r = await fetch(`${BASE}/api/stores/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng })
  });
  return r.ok;
}

async function main() {
  console.log('=== GEOCODE STORES ===\n');

  // Fetch all stores via API
  const allStores = await (await fetch(`${BASE}/api/stores`)).json();
  const stores = allStores.filter(s => !s.lat || !s.lng);
  console.log(`${allStores.length} total stores, ${stores.length} need geocoding\n`);

  let success = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < stores.length; i++) {
    const s = stores[i];
    process.stdout.write(`[${i + 1}/${stores.length}] ${s.name.padEnd(35)} `);

    // Attempt 1: full address + state + México
    const addr = cleanAddress(s.address);
    const query1 = [addr, s.city, s.state, 'México'].filter(Boolean).join(', ');
    let result = await geocode(query1);

    if (!result) {
      // Attempt 2: store name + state + México
      await sleep(1100);
      const query2 = `${s.name}, ${s.state}, México`;
      result = await geocode(query2);
    }

    if (!result && s.city) {
      // Attempt 3: just city + state
      await sleep(1100);
      result = await geocode(`${s.city}, ${s.state}, México`);
    }

    if (!result && s.state) {
      // Attempt 4: just state capital as fallback
      await sleep(1100);
      result = await geocode(`${s.state}, México`);
    }

    if (result) {
      const ok = await updateStore(s.id, result.lat, result.lng);
      console.log(ok ? `✓ ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}` : 'API ERROR');
      if (ok) success++; else failed++;
    } else {
      console.log('✗ NOT FOUND');
      failures.push({ id: s.id, name: s.name, state: s.state });
      failed++;
    }

    await sleep(1100);
  }

  console.log('\n=== RESULTS ===');
  console.log(`Success: ${success}/${stores.length}`);
  console.log(`Failed:  ${failed}/${stores.length}`);

  if (failures.length > 0) {
    console.log('\n--- Failed stores ---');
    failures.forEach(f => console.log(`  [${f.id}] ${f.name} (${f.state})`));
  }

  // Verification
  const updated = await (await fetch(`${BASE}/api/stores`)).json();
  const withCoords = updated.filter(s => s.lat && s.lng).length;
  console.log(`\n=== VERIFICATION ===`);
  console.log(`Stores with coordinates: ${withCoords}/${updated.length}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
