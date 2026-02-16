const { Pool } = require('pg');

let pool = null;

// Convert SQLite ? placeholders to PostgreSQL $1, $2, $3...
function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

// Initialize database
async function initDB() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('ERROR: DATABASE_URL not set!');
    process.exit(1);
  }

  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Test connection
  try {
    const client = await pool.connect();
    console.log('PostgreSQL connected');
    client.release();
  } catch (e) {
    console.error('PostgreSQL connection error:', e.message);
    process.exit(1);
  }

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      format TEXT,
      finish TEXT,
      type TEXT,
      resistance TEXT,
      water_absorption TEXT,
      mohs TEXT,
      usage TEXT,
      pieces_per_box INTEGER,
      sqm_per_box REAL,
      weight_per_box REAL,
      image_url TEXT,
      video_url TEXT,
      pdf_url TEXT,
      base_price REAL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      related_products TEXT,
      tech_description TEXT,
      url TEXT,
      slug TEXT,
      description TEXT,
      pei INTEGER,
      gallery TEXT,
      official_url TEXT,
      uses TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS distributors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      logo_url TEXT,
      website TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      distributor_id INTEGER NOT NULL REFERENCES distributors(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      state TEXT NOT NULL,
      city TEXT NOT NULL,
      address TEXT,
      postal_code TEXT,
      lat REAL,
      lng REAL,
      whatsapp TEXT,
      phone TEXT,
      email TEXT,
      manager_name TEXT,
      promo_text TEXT,
      promo_discount TEXT,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      store_id INTEGER,
      session_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      source TEXT DEFAULT 'qr',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_clicks (
      id SERIAL PRIMARY KEY,
      scan_id INTEGER,
      product_id INTEGER NOT NULL REFERENCES products(id),
      store_id INTEGER,
      session_id TEXT,
      whatsapp_number TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qr_codes (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      store_id INTEGER NOT NULL REFERENCES stores(id),
      url TEXT NOT NULL,
      qr_data TEXT,
      downloads INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS terra_conversations (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      customer_name TEXT,
      store_name TEXT,
      product_id INTEGER,
      product_name TEXT,
      question TEXT NOT NULL,
      answer TEXT,
      intent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS terra_sessions (
      id SERIAL PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      customer_name TEXT,
      store_id INTEGER,
      store_name TEXT,
      products_visited TEXT,
      conversation_count INTEGER DEFAULT 0,
      recommendation TEXT,
      whatsapp_sent INTEGER DEFAULT 0,
      duration_minutes REAL,
      started_at TIMESTAMP DEFAULT NOW(),
      ended_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wa_conversations (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      phone TEXT,
      name TEXT,
      source TEXT NOT NULL DEFAULT 'unknown',
      store_name TEXT,
      store_id INTEGER,
      products_interested TEXT,
      terra_session_id TEXT,
      status TEXT DEFAULT 'new',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Add columns if not exists
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS advisor_name TEXT`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP`);

  // Store inventory
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_inventory (
      id SERIAL PRIMARY KEY,
      store_id INTEGER REFERENCES stores(id),
      product_id INTEGER REFERENCES products(id),
      in_stock BOOLEAN DEFAULT true,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(store_id, product_id)
    )
  `);

  // CRM users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Additional tables that may exist in server.js
  await pool.query(`
    CREATE TABLE IF NOT EXISTS landings (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      title TEXT,
      description TEXT,
      promo_text TEXT,
      video_url TEXT,
      image_url TEXT,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sample_requests (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER,
      product_id INTEGER,
      store_id INTEGER,
      name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id SERIAL PRIMARY KEY,
      product_id INTEGER,
      product_name TEXT,
      product_sku TEXT,
      m2 REAL,
      price_per_m2 REAL,
      total REAL,
      store_id INTEGER,
      store_name TEXT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      status TEXT DEFAULT 'sent',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      customer_name TEXT,
      rating INTEGER,
      comment TEXT,
      source TEXT,
      approved INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Create indexes for common lookups
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_conversations_phone ON wa_conversations(phone)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stores_slug ON stores(slug)`);

  console.log('PostgreSQL tables ready');

  // Seed data if empty
  await seedData();

  return pool;
}

// Helper: run query and return rows (replaces sql.js query)
function query(sql, params = []) {
  try {
    const pgSql = convertPlaceholders(sql);
    const result = pool.query(pgSql, params);
    // Return a promise-like that also works synchronously via .then()
    // But since we need sync behavior for backward compat, we use a sync wrapper
    // Actually, we need to make this async-compatible
    return result.then(r => r.rows);
  } catch (e) {
    console.error('Query error:', e.message, sql);
    return Promise.resolve([]);
  }
}

function queryOne(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  return pool.query(pgSql, params)
    .then(r => r.rows.length > 0 ? r.rows[0] : null)
    .catch(e => {
      console.error('QueryOne error:', e.message, sql);
      return null;
    });
}

function run(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  return pool.query(pgSql, params)
    .then(r => ({ rowCount: r.rowCount, rows: r.rows }))
    .catch(e => {
      console.error('Run error:', e.message, sql);
      throw e;
    });
}

function scalar(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  return pool.query(pgSql, params)
    .then(r => r.rows.length > 0 ? Object.values(r.rows[0])[0] : null)
    .catch(e => {
      console.error('Scalar error:', e.message, sql);
      return null;
    });
}

// No-op for backward compat (SQLite used to save to file)
function saveDB() {}

function getDB() { return pool; }

async function seedData() {
  const result = await pool.query('SELECT COUNT(*) as c FROM products');
  if (parseInt(result.rows[0].c) > 0) {
    console.log(`Database already has ${result.rows[0].c} products`);
    return;
  }

  console.log('Seeding database from JSON files...');
  const fs = require('fs');
  const path = require('path');
  const seedDir = path.join(__dirname, 'data', 'seed');

  // Seed distributors first (stores depend on them)
  try {
    const distributors = JSON.parse(fs.readFileSync(path.join(seedDir, 'distributors.json'), 'utf8'));
    for (const d of distributors) {
      await pool.query(`INSERT INTO distributors (id, name, slug, logo_url, website, contact_email, contact_phone, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (slug) DO NOTHING`,
        [d.id, d.name, d.slug, d.logo_url, d.website, d.contact_email, d.contact_phone, d.active ?? 1]);
    }
    await pool.query(`SELECT setval('distributors_id_seq', COALESCE((SELECT MAX(id) FROM distributors), 1))`);
    console.log(`  Seeded ${distributors.length} distributors`);
  } catch (e) { console.error('Distributor seed error:', e.message); }

  // Seed stores
  try {
    const stores = JSON.parse(fs.readFileSync(path.join(seedDir, 'stores.json'), 'utf8'));
    for (const s of stores) {
      await pool.query(`INSERT INTO stores (id, distributor_id, name, slug, state, city, address, postal_code,
        lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING`,
        [s.id, s.distributor_id, s.name, s.slug, s.state, s.city, s.address, s.postal_code,
         s.lat, s.lng, s.whatsapp, s.phone, s.email, s.manager_name, s.promo_text, s.promo_discount, s.active ?? 1]);
    }
    await pool.query(`SELECT setval('stores_id_seq', COALESCE((SELECT MAX(id) FROM stores), 1))`);
    console.log(`  Seeded ${stores.length} stores`);
  } catch (e) { console.error('Store seed error:', e.message); }

  // Seed products
  try {
    const products = JSON.parse(fs.readFileSync(path.join(seedDir, 'products.json'), 'utf8'));
    for (const p of products) {
      await pool.query(`INSERT INTO products (id, sku, name, category, subcategory, format, finish, type, resistance,
        water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, image_url,
        video_url, pdf_url, base_price, active, url, slug, description, pei, gallery, official_url, uses)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
        ON CONFLICT (sku) DO NOTHING`,
        [p.id, p.sku, p.name, p.category, p.subcategory, p.format, p.finish, p.type, p.resistance,
         p.water_absorption, p.mohs, p.usage, p.pieces_per_box, p.sqm_per_box, p.weight_per_box,
         p.image_url, p.video_url, p.pdf_url, p.base_price, p.active ?? 1,
         p.url, p.slug, p.description, p.pei, p.gallery, p.official_url, p.uses]);
    }
    await pool.query(`SELECT setval('products_id_seq', COALESCE((SELECT MAX(id) FROM products), 1))`);
    console.log(`  Seeded ${products.length} products`);
  } catch (e) { console.error('Product seed error:', e.message); }

  console.log('Database seeding complete!');
}

module.exports = { initDB, getDB, query, queryOne, run, scalar, saveDB };
