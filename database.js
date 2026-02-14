const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
const DB_PATH = path.join(__dirname, 'data', 'cesantoni.db');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// Initialize database
async function initDB() {
  const SQL = await initSqlJs();
  
  // Try to load existing database
  try {
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
      console.log('Database loaded from file');
    } else {
      db = new SQL.Database();
      console.log('New database created');
    }
  } catch (e) {
    db = new SQL.Database();
    console.log('New database created (error loading):', e.message);
  }
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS distributors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      logo_url TEXT,
      website TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distributor_id INTEGER NOT NULL,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (distributor_id) REFERENCES distributors(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      store_id INTEGER,
      session_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      source TEXT DEFAULT 'qr',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (store_id) REFERENCES stores(id)
    )
  `);

  // Agregar columna source si no existe (para bases de datos existentes)
  try {
    db.run(`ALTER TABLE scans ADD COLUMN source TEXT DEFAULT 'qr'`);
  } catch (e) {
    // Columna ya existe
  }

  // Agregar columna related_products para productos similares
  try {
    db.run(`ALTER TABLE products ADD COLUMN related_products TEXT`);
  } catch (e) {
    // Columna ya existe
  }

  // Agregar columna tech_description para descripción técnica única generada con IA
  try {
    db.run(`ALTER TABLE products ADD COLUMN tech_description TEXT`);
  } catch (e) {
    // Columna ya existe
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER,
      product_id INTEGER NOT NULL,
      store_id INTEGER,
      session_id TEXT,
      whatsapp_number TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (scan_id) REFERENCES scans(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (store_id) REFERENCES stores(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      qr_data TEXT,
      downloads INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (store_id) REFERENCES stores(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS terra_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      customer_name TEXT,
      store_name TEXT,
      product_id INTEGER,
      product_name TEXT,
      question TEXT NOT NULL,
      answer TEXT,
      intent TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS terra_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      customer_name TEXT,
      store_id INTEGER,
      store_name TEXT,
      products_visited TEXT,
      conversation_count INTEGER DEFAULT 0,
      recommendation TEXT,
      whatsapp_sent INTEGER DEFAULT 0,
      duration_minutes REAL,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wa_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      name TEXT,
      source TEXT NOT NULL DEFAULT 'unknown',
      store_name TEXT,
      store_id INTEGER,
      products_interested TEXT,
      terra_session_id TEXT,
      status TEXT DEFAULT 'new',
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed data
  seedData();
  
  // Save to file
  saveDB();
  
  return db;
}

function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function seedData() {
  // Check if already seeded
  const result = db.exec('SELECT COUNT(*) as c FROM products');
  if (result.length > 0 && result[0].values[0][0] > 0) {
    console.log('Database already seeded');
    return;
  }

  console.log('Seeding database...');

  // Products
  const products = [
    ['VOL-3060-EST', 'Volterra', 'Muro', '30x60cm', 'Piedra Estructurado', 'Pasta Blanca', '≥120 kg', '15-20%', '5-8', 'Interior, Baños, Cocina', 8, 1.44, 24.55, 385],
    ['CAR-6060-PUL', 'Carrara Blanco', 'Piso', '60x60cm', 'Mármol Pulido', 'Porcelanato', '≥200 kg', '<0.5%', '6-7', 'Interior, Salas', 4, 1.44, 28.5, 520],
    ['NER-6060-PUL', 'Nero Marquina', 'Piso', '60x60cm', 'Mármol Pulido', 'Porcelanato', '≥200 kg', '<0.5%', '6-7', 'Interior, Salas', 4, 1.44, 28.5, 580],
    ['TRA-6060-MAT', 'Travertino Gold', 'Piso', '60x60cm', 'Piedra Mate', 'Porcelanato', '≥180 kg', '<1%', '5-6', 'Interior, Exterior', 4, 1.44, 27.8, 495],
    ['ONX-3060-BRI', 'Onyx Honey', 'Muro', '30x60cm', 'Brillante', 'Pasta Blanca', '≥120 kg', '15-20%', '5-8', 'Interior, Baños', 8, 1.44, 24.55, 420],
    ['EMP-6060-PUL', 'Emperador Dark', 'Piso', '60x60cm', 'Mármol Pulido', 'Porcelanato', '≥200 kg', '<0.5%', '6-7', 'Interior, Salas', 4, 1.44, 28.5, 545],
    ['CAL-4545-MAT', 'Calacatta', 'Piso', '45x45cm', 'Mate', 'Porcelanato', '≥180 kg', '<1%', '6-7', 'Interior', 6, 1.22, 22.3, 465],
    ['STA-3060-EST', 'Statuario', 'Muro', '30x60cm', 'Estructurado', 'Pasta Blanca', '≥120 kg', '15-20%', '5-8', 'Interior, Baños', 8, 1.44, 24.55, 410],
    ['GRI-6060-MAT', 'Grigio Carnico', 'Piso', '60x60cm', 'Mate', 'Porcelanato', '≥200 kg', '<0.5%', '6-7', 'Interior, Comercial', 4, 1.44, 28.5, 510],
    ['BEI-4590-NAT', 'Beige Crema', 'Piso', '45x90cm', 'Natural', 'Porcelanato', '≥180 kg', '<1%', '5-6', 'Interior, Exterior', 3, 1.22, 26.4, 475],
    ['WOO-2012-MAT', 'Wood Roble', 'Piso', '20x120cm', 'Madera Mate', 'Porcelanato', '≥180 kg', '<1%', '5-6', 'Interior, Salas', 5, 1.20, 24.8, 445],
    ['CEM-6060-RUS', 'Cemento Gris', 'Piso', '60x60cm', 'Rústico', 'Porcelanato', '≥200 kg', '<0.5%', '7-8', 'Interior, Exterior', 4, 1.44, 29.2, 390],
  ];

  products.forEach(p => {
    db.run(`INSERT INTO products (sku, name, category, format, finish, type, resistance, water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, base_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p);
  });

  // Distributors
  const distributors = [
    ['Interceramic', 'interceramic', 'https://interceramic.com', '800-123-4567'],
    ['Home Depot', 'homedepot', 'https://homedepot.com.mx', '800-004-6633'],
    ['Porcelanite', 'porcelanite', 'https://porcelanite.com.mx', '800-890-1234'],
    ['Lamosa', 'lamosa', 'https://lamosa.com.mx', '800-505-0000'],
    ['Vitromex', 'vitromex', 'https://vitromex.com.mx', '800-712-0033'],
    ['Daltile', 'daltile', 'https://daltile.com.mx', '800-343-4433'],
  ];

  distributors.forEach(d => {
    db.run(`INSERT INTO distributors (name, slug, website, contact_phone) VALUES (?, ?, ?, ?)`, d);
  });

  // Stores
  const stores = [
    [1, 'Interceramic Polanco', 'polanco', 'CDMX', 'Ciudad de México', 'Av. Presidente Masaryk 340, Polanco', '5215512345678', 'Instalación gratis', '15%'],
    [1, 'Interceramic Santa Fe', 'santafe', 'CDMX', 'Ciudad de México', 'Centro Santa Fe Local 234', '5215512345679', 'Diseño 3D gratis', '10%'],
    [1, 'Interceramic Zapopan', 'zapopan', 'Jalisco', 'Zapopan', 'Av. Patria 1234, Zapopan', '5213312345678', 'Envío gratis GDL', '12%'],
    [1, 'Interceramic Valle', 'valle', 'Nuevo León', 'San Pedro Garza García', 'Calzada del Valle 500', '5218112345678', 'Asesoría premium', '20%'],
    [1, 'Interceramic Cancún', 'cancun', 'Quintana Roo', 'Cancún', 'Blvd. Kukulcán Km 12', '5219981234567', 'Para hoteles -25%', '25%'],
    [2, 'Home Depot Pedregal', 'pedregal', 'CDMX', 'Ciudad de México', 'Periférico Sur 4020, Pedregal', '5215598765432', 'Meses sin intereses', ''],
    [2, 'Home Depot Satélite', 'satelite', 'Estado de México', 'Naucalpan', 'Periférico Norte, Ciudad Satélite', '5215598765433', '18 MSI', ''],
    [2, 'Home Depot Guadalajara', 'guadalajara', 'Jalisco', 'Guadalajara', 'Av. Vallarta 5555', '5213398765432', '12 MSI + envío', ''],
    [2, 'Home Depot Monterrey', 'monterrey', 'Nuevo León', 'Monterrey', 'Av. Constitución 2000', '5218198765432', 'Instalación $99/m²', ''],
    [3, 'Porcelanite GDL Centro', 'gdl-centro', 'Jalisco', 'Guadalajara', 'Av. Juárez 890, Centro', '5213387654321', 'Liquidación 30%', '30%'],
    [3, 'Porcelanite Cumbres', 'cumbres', 'Nuevo León', 'Monterrey', 'Av. Cumbres 456', '5218187654321', 'Precio de fábrica', '18%'],
    [3, 'Porcelanite Metepec', 'metepec', 'Estado de México', 'Metepec', 'Av. Tecnológico 234', '5217287654321', 'Outlet -40%', '40%'],
    [4, 'Lamosa San Pedro', 'sanpedro', 'Nuevo León', 'San Pedro Garza García', 'Av. Vasconcelos 1000', '5218176543210', 'Arquitectos 25% off', '25%'],
    [4, 'Lamosa Insurgentes', 'insurgentes', 'CDMX', 'Ciudad de México', 'Av. Insurgentes Sur 1800', '5215576543210', 'Proyecto completo', '15%'],
    [4, 'Lamosa Querétaro', 'queretaro', 'Querétaro', 'Querétaro', 'Blvd. Bernardo Quintana 500', '5214476543210', 'Envío gratis Bajío', ''],
    [5, 'Vitromex Plaza del Sol', 'plazadelsol', 'Jalisco', 'Guadalajara', 'Plaza del Sol Local 45', '5213365432109', 'Temporada -20%', '20%'],
    [5, 'Vitromex Puebla', 'puebla', 'Puebla', 'Puebla', 'Blvd. 5 de Mayo 234', '5222265432109', 'Instalación incluida', ''],
    [6, 'Daltile Design Studio', 'designstudio', 'CDMX', 'Ciudad de México', 'Av. Palmas 100, Lomas', '5215554321098', 'Diseño premium', ''],
    [6, 'Daltile Cancún', 'cancun-daltile', 'Quintana Roo', 'Cancún', 'Av. Tulum 234', '5219984321098', 'Hoteles boutique', '22%'],
  ];

  stores.forEach(s => {
    db.run(`INSERT INTO stores (distributor_id, name, slug, state, city, address, whatsapp, promo_text, promo_discount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, s);
  });

  // Generate random scans
  const now = new Date();
  for (let i = 0; i < 500; i++) {
    const productId = Math.floor(Math.random() * 12) + 1;
    const storeId = Math.floor(Math.random() * 19) + 1;
    const sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    const daysAgo = Math.floor(Math.random() * 30);
    const hoursAgo = Math.floor(Math.random() * 24);
    const date = new Date(now - daysAgo * 24 * 60 * 60 * 1000 - hoursAgo * 60 * 60 * 1000);
    const dateStr = date.toISOString().replace('T', ' ').substr(0, 19);
    
    db.run(`INSERT INTO scans (product_id, store_id, session_id, created_at) VALUES (?, ?, ?, ?)`,
           [productId, storeId, sessionId, dateStr]);
    
    // 20% result in WhatsApp click
    if (Math.random() < 0.2) {
      db.run(`INSERT INTO whatsapp_clicks (product_id, store_id, session_id, created_at) VALUES (?, ?, ?, ?)`,
             [productId, storeId, sessionId, dateStr]);
    }
  }

  console.log('Database seeded successfully!');
}

// Helper functions
function getDB() {
  return db;
}

function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (e) {
    console.error('Query error:', e.message, sql);
    return [];
  }
}

function queryOne(sql, params = []) {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDB();
    return { lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] || 0 };
  } catch (e) {
    console.error('Run error:', e.message, sql);
    throw e;
  }
}

function scalar(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    stmt.step();
    const result = stmt.get();
    stmt.free();
    return result ? result[0] : null;
  } catch (e) {
    console.error('Scalar error:', e.message, sql);
    return null;
  }
}

module.exports = { initDB, getDB, query, queryOne, run, scalar, saveDB };
