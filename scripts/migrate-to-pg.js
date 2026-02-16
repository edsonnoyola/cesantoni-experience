#!/usr/bin/env node
/**
 * Migrate data from current SQLite API to new PostgreSQL database
 * Run AFTER deploying the new PG-backed server (tables auto-created)
 * Uses the external PG connection string to insert data directly
 */

const { Pool } = require('pg');

const SOURCE_API = 'https://cesantoni-experience-za74.onrender.com';
const PG_EXTERNAL = process.env.DATABASE_URL || 'postgresql://cesantoni_user:U1nbDDhtUsOZqfmWGqUc49c84s6513CM@dpg-d68jl9ur433s73ckke20-a.oregon-postgres.render.com:5432/cesantoni';

async function fetchJSON(path) {
  const r = await fetch(`${SOURCE_API}${path}`);
  if (!r.ok) throw new Error(`API ${path}: ${r.status}`);
  return r.json();
}

async function main() {
  console.log('Connecting to PostgreSQL...');
  const pool = new Pool({
    connectionString: PG_EXTERNAL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  console.log('Connected!\n');

  try {
    // Check if already migrated
    const existing = await client.query('SELECT COUNT(*) as c FROM products');
    if (parseInt(existing.rows[0].c) > 0) {
      console.log(`Products already exist (${existing.rows[0].c}). Skipping product migration.`);
    } else {
      // 1. Migrate products
      console.log('=== Migrating Products ===');
      const products = await fetchJSON('/api/products');
      console.log(`Fetched ${products.length} products from API`);

      for (const p of products) {
        await client.query(`
          INSERT INTO products (id, sku, name, category, subcategory, format, finish, type, resistance,
            water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, image_url,
            video_url, pdf_url, base_price, active, url, slug, description, pei, gallery, official_url, uses)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
          ON CONFLICT (sku) DO NOTHING`,
          [p.id, p.sku, p.name, p.category, p.subcategory, p.format, p.finish, p.type, p.resistance,
           p.water_absorption, p.mohs, p.usage, p.pieces_per_box, p.sqm_per_box, p.weight_per_box,
           p.image_url, p.video_url, p.pdf_url, p.base_price, p.active ?? 1,
           p.url, p.slug, p.description, p.pei, p.gallery, p.official_url, p.uses]);
      }
      // Reset sequence to max id
      await client.query(`SELECT setval('products_id_seq', (SELECT MAX(id) FROM products))`);
      console.log(`Inserted ${products.length} products\n`);
    }

    // 2. Migrate distributors
    const distCheck = await client.query('SELECT COUNT(*) as c FROM distributors');
    if (parseInt(distCheck.rows[0].c) > 0) {
      console.log('Distributors already exist. Skipping.');
    } else {
      console.log('=== Migrating Distributors ===');
      const distributors = await fetchJSON('/api/distributors');
      console.log(`Fetched ${distributors.length} distributors`);

      for (const d of distributors) {
        await client.query(`
          INSERT INTO distributors (id, name, slug, logo_url, website, contact_email, contact_phone, active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (slug) DO NOTHING`,
          [d.id, d.name, d.slug, d.logo_url, d.website, d.contact_email, d.contact_phone, d.active ?? 1]);
      }
      await client.query(`SELECT setval('distributors_id_seq', (SELECT MAX(id) FROM distributors))`);
      console.log(`Inserted ${distributors.length} distributors\n`);
    }

    // 3. Migrate stores
    const storeCheck = await client.query('SELECT COUNT(*) as c FROM stores');
    if (parseInt(storeCheck.rows[0].c) > 0) {
      console.log('Stores already exist. Skipping.');
    } else {
      console.log('=== Migrating Stores ===');
      const stores = await fetchJSON('/api/stores');
      console.log(`Fetched ${stores.length} stores`);

      for (const s of stores) {
        await client.query(`
          INSERT INTO stores (id, distributor_id, name, slug, state, city, address, postal_code,
            lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount, active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT DO NOTHING`,
          [s.id, s.distributor_id, s.name, s.slug, s.state, s.city, s.address, s.postal_code,
           s.lat, s.lng, s.whatsapp, s.phone, s.email, s.manager_name, s.promo_text, s.promo_discount, s.active ?? 1]);
      }
      await client.query(`SELECT setval('stores_id_seq', (SELECT MAX(id) FROM stores))`);
      console.log(`Inserted ${stores.length} stores\n`);
    }

    // Verify
    console.log('\n=== VERIFICATION ===');
    const pCount = await client.query('SELECT COUNT(*) FROM products');
    const dCount = await client.query('SELECT COUNT(*) FROM distributors');
    const sCount = await client.query('SELECT COUNT(*) FROM stores');
    console.log(`Products: ${pCount.rows[0].count}`);
    console.log(`Distributors: ${dCount.rows[0].count}`);
    console.log(`Stores: ${sCount.rows[0].count}`);

  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n=== MIGRATION COMPLETE ===');
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
