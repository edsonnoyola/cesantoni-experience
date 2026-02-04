const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');
const { initDB, query, queryOne, run, scalar } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// =====================================================
// API: PRODUCTOS
// =====================================================

app.get('/api/products', (req, res) => {
  try {
    const { category, search, active } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (name LIKE ? OR sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (active !== undefined) {
      sql += ' AND active = ?';
      params.push(active);
    }

    sql += ' ORDER BY name';
    const products = query(sql, params);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/:id', (req, res) => {
  try {
    const product = queryOne('SELECT * FROM products WHERE id = ?', [parseInt(req.params.id)]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/sku/:sku', (req, res) => {
  try {
    const product = queryOne('SELECT * FROM products WHERE sku = ?', [req.params.sku]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', (req, res) => {
  try {
    const { sku, name, category, format, finish, type, resistance, water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, base_price } = req.body;
    
    const result = run(`
      INSERT INTO products (sku, name, category, format, finish, type, resistance, water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, base_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [sku, name, category, format, finish, type, resistance, water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, base_price]);

    res.json({ id: result.lastInsertRowid, message: 'Producto creado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', (req, res) => {
  try {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (fields.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });
    
    values.push(parseInt(req.params.id));
    run(`UPDATE products SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', (req, res) => {
  try {
    run('UPDATE products SET active = 0 WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ message: 'Producto desactivado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: DISTRIBUIDORES
// =====================================================

app.get('/api/distributors', (req, res) => {
  try {
    const distributors = query(`
      SELECT d.*, 
        (SELECT COUNT(*) FROM stores WHERE distributor_id = d.id) as store_count,
        (SELECT COUNT(*) FROM scans s JOIN stores st ON s.store_id = st.id WHERE st.distributor_id = d.id) as total_scans
      FROM distributors d
      WHERE d.active = 1
      ORDER BY d.name
    `);
    res.json(distributors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/distributors/:id', (req, res) => {
  try {
    const distributor = queryOne('SELECT * FROM distributors WHERE id = ?', [parseInt(req.params.id)]);
    if (!distributor) return res.status(404).json({ error: 'Distribuidor no encontrado' });
    
    distributor.stores = query('SELECT * FROM stores WHERE distributor_id = ? AND active = 1', [parseInt(req.params.id)]);
    res.json(distributor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/distributors', (req, res) => {
  try {
    const { name, slug, logo_url, website, contact_email, contact_phone } = req.body;
    const result = run(`
      INSERT INTO distributors (name, slug, logo_url, website, contact_email, contact_phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, slug, logo_url, website, contact_email, contact_phone]);
    
    res.json({ id: result.lastInsertRowid, message: 'Distribuidor creado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: TIENDAS
// =====================================================

app.get('/api/stores', (req, res) => {
  try {
    const { distributor_id, state, city } = req.query;
    let sql = `
      SELECT s.*, d.name as distributor_name,
        (SELECT COUNT(*) FROM scans WHERE store_id = s.id) as total_scans,
        (SELECT COUNT(*) FROM whatsapp_clicks WHERE store_id = s.id) as total_clicks
      FROM stores s
      JOIN distributors d ON s.distributor_id = d.id
      WHERE s.active = 1
    `;
    const params = [];

    if (distributor_id) {
      sql += ' AND s.distributor_id = ?';
      params.push(parseInt(distributor_id));
    }
    if (state) {
      sql += ' AND s.state = ?';
      params.push(state);
    }
    if (city) {
      sql += ' AND s.city = ?';
      params.push(city);
    }

    sql += ' ORDER BY s.state, s.city, s.name';
    const stores = query(sql, params);
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stores/:id', (req, res) => {
  try {
    const store = queryOne(`
      SELECT s.*, d.name as distributor_name
      FROM stores s
      JOIN distributors d ON s.distributor_id = d.id
      WHERE s.id = ?
    `, [parseInt(req.params.id)]);
    if (!store) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stores', (req, res) => {
  try {
    const { distributor_id, name, slug, state, city, address, postal_code, lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount } = req.body;
    
    const result = run(`
      INSERT INTO stores (distributor_id, name, slug, state, city, address, postal_code, lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [distributor_id, name, slug, state, city, address, postal_code, lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount]);

    res.json({ id: result.lastInsertRowid, message: 'Tienda creada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/stores/:id', (req, res) => {
  try {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (fields.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });
    
    values.push(parseInt(req.params.id));
    run(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`, values);
    
    res.json({ message: 'Tienda actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: TRACKING (ESCANEOS)
// =====================================================

app.post('/api/track/scan', (req, res) => {
  try {
    const { product_id, store_id, session_id, utm_source, utm_medium, utm_campaign } = req.body;
    const ip_address = req.ip || req.connection?.remoteAddress || '';
    const user_agent = req.headers['user-agent'] || '';
    const referrer = req.headers.referer || req.headers.referrer || '';

    const result = run(`
      INSERT INTO scans (product_id, store_id, session_id, ip_address, user_agent, referrer, utm_source, utm_medium, utm_campaign)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [product_id, store_id || null, session_id, ip_address, user_agent, referrer, utm_source || null, utm_medium || null, utm_campaign || null]);

    res.json({ scan_id: result.lastInsertRowid, message: 'Escaneo registrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/track/whatsapp', (req, res) => {
  try {
    const { scan_id, product_id, store_id, session_id, whatsapp_number } = req.body;

    const result = run(`
      INSERT INTO whatsapp_clicks (scan_id, product_id, store_id, session_id, whatsapp_number)
      VALUES (?, ?, ?, ?, ?)
    `, [scan_id || null, product_id, store_id || null, session_id, whatsapp_number || null]);

    res.json({ click_id: result.lastInsertRowid, message: 'Click registrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: ANALYTICS
// =====================================================

app.get('/api/analytics/overview', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const total_scans = scalar(`SELECT COUNT(*) FROM scans WHERE created_at >= datetime('now', '-${days} days')`) || 0;
    const total_stores = scalar('SELECT COUNT(*) FROM stores WHERE active = 1') || 0;
    const total_products = scalar('SELECT COUNT(*) FROM products WHERE active = 1') || 0;
    const total_wa_clicks = scalar(`SELECT COUNT(*) FROM whatsapp_clicks WHERE created_at >= datetime('now', '-${days} days')`) || 0;

    const conversion_rate = total_scans > 0 
      ? ((total_wa_clicks / total_scans) * 100).toFixed(1)
      : 0;

    res.json({
      total_scans,
      total_stores,
      total_products,
      total_wa_clicks,
      conversion_rate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/by-state', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const data = query(`
      SELECT 
        st.state,
        COUNT(DISTINCT st.id) as stores,
        COUNT(s.id) as scans,
        COUNT(w.id) as clicks,
        ROUND(CAST(COUNT(w.id) AS FLOAT) / MAX(COUNT(s.id), 1) * 100, 1) as conversion_rate
      FROM stores st
      LEFT JOIN scans s ON s.store_id = st.id AND s.created_at >= datetime('now', '-${days} days')
      LEFT JOIN whatsapp_clicks w ON w.store_id = st.id AND w.created_at >= datetime('now', '-${days} days')
      WHERE st.active = 1
      GROUP BY st.state
      ORDER BY scans DESC
    `);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/by-store', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const state = req.query.state;
    const limit = parseInt(req.query.limit) || 20;
    
    let sql = `
      SELECT 
        st.id,
        st.name,
        st.state,
        st.city,
        d.name as distributor_name,
        COUNT(s.id) as scans,
        COUNT(w.id) as clicks,
        ROUND(CAST(COUNT(w.id) AS FLOAT) / MAX(COUNT(s.id), 1) * 100, 1) as conversion_rate
      FROM stores st
      JOIN distributors d ON st.distributor_id = d.id
      LEFT JOIN scans s ON s.store_id = st.id AND s.created_at >= datetime('now', '-${days} days')
      LEFT JOIN whatsapp_clicks w ON w.store_id = st.id AND w.created_at >= datetime('now', '-${days} days')
      WHERE st.active = 1
    `;
    const params = [];

    if (state) {
      sql += ' AND st.state = ?';
      params.push(state);
    }

    sql += ` GROUP BY st.id ORDER BY scans DESC LIMIT ?`;
    params.push(limit);

    const data = query(sql, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/by-product', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const limit = parseInt(req.query.limit) || 10;
    
    const data = query(`
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.category,
        p.finish,
        COUNT(s.id) as scans,
        COUNT(w.id) as clicks,
        ROUND(CAST(COUNT(w.id) AS FLOAT) / MAX(COUNT(s.id), 1) * 100, 1) as conversion_rate
      FROM products p
      LEFT JOIN scans s ON s.product_id = p.id AND s.created_at >= datetime('now', '-${days} days')
      LEFT JOIN whatsapp_clicks w ON w.product_id = p.id AND w.created_at >= datetime('now', '-${days} days')
      WHERE p.active = 1
      GROUP BY p.id
      ORDER BY scans DESC
      LIMIT ?
    `, [limit]);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/by-day', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    
    const data = query(`
      SELECT 
        DATE(created_at) as date,
        strftime('%w', created_at) as day_of_week,
        COUNT(*) as scans
      FROM scans
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const data = query(`
      SELECT 
        s.id,
        s.created_at,
        p.name as product_name,
        p.sku,
        st.name as store_name,
        st.state,
        st.city,
        CASE WHEN w.id IS NOT NULL THEN 1 ELSE 0 END as converted
      FROM scans s
      JOIN products p ON s.product_id = p.id
      LEFT JOIN stores st ON s.store_id = st.id
      LEFT JOIN whatsapp_clicks w ON w.scan_id = s.id
      ORDER BY s.created_at DESC
      LIMIT ?
    `, [limit]);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: QR CODES
// =====================================================

app.post('/api/qr/generate', async (req, res) => {
  try {
    const { product_id, store_id } = req.body;

    const product = queryOne('SELECT * FROM products WHERE id = ?', [parseInt(product_id)]);
    const store = queryOne(`
      SELECT s.*, d.slug as distributor_slug 
      FROM stores s 
      JOIN distributors d ON s.distributor_id = d.id 
      WHERE s.id = ?
    `, [parseInt(store_id)]);

    if (!product || !store) {
      return res.status(404).json({ error: 'Producto o tienda no encontrado' });
    }

    const params = new URLSearchParams({
      tienda: `${store.distributor_slug}-${store.slug}`,
      estado: store.state,
      ciudad: store.city,
      dir: store.address || '',
      wa: store.whatsapp || '',
      promo: store.promo_discount || ''
    });

    const url = `${BASE_URL}/p/${product.sku.toLowerCase()}?${params.toString()}`;

    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' }
    });

    // Save to DB
    run(`
      INSERT OR REPLACE INTO qr_codes (product_id, store_id, url, qr_data)
      VALUES (?, ?, ?, ?)
    `, [product_id, store_id, url, qrDataUrl]);

    res.json({
      url,
      qr_data: qrDataUrl,
      product: product.name,
      store: store.name
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/qr/list', (req, res) => {
  try {
    const { product_id, store_id } = req.query;
    let sql = `
      SELECT qr.*, p.name as product_name, p.sku, st.name as store_name, st.state
      FROM qr_codes qr
      JOIN products p ON qr.product_id = p.id
      JOIN stores st ON qr.store_id = st.id
      WHERE 1=1
    `;
    const params = [];

    if (product_id) {
      sql += ' AND qr.product_id = ?';
      params.push(parseInt(product_id));
    }
    if (store_id) {
      sql += ' AND qr.store_id = ?';
      params.push(parseInt(store_id));
    }

    sql += ' ORDER BY qr.created_at DESC';
    const qrs = query(sql, params);
    res.json(qrs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: UTILIDADES
// =====================================================

app.get('/api/states', (req, res) => {
  try {
    const states = query(`
      SELECT DISTINCT state, COUNT(*) as store_count
      FROM stores
      WHERE active = 1
      GROUP BY state
      ORDER BY state
    `);
    res.json(states);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', (req, res) => {
  try {
    const categories = query(`
      SELECT DISTINCT category, COUNT(*) as product_count
      FROM products
      WHERE active = 1 AND category IS NOT NULL
      GROUP BY category
      ORDER BY category
    `);
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// LANDING PAGE DINÁMICO
// =====================================================

app.get('/p/:sku', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/api/landing/:sku', (req, res) => {
  try {
    // Search by SKU or slug
    const param = req.params.sku.toLowerCase();
    let product = queryOne('SELECT * FROM products WHERE LOWER(sku) = ?', [param]);
    if (!product) {
      product = queryOne('SELECT * FROM products WHERE LOWER(slug) = ?', [param]);
    }
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// INICIO
// =====================================================

async function start() {
  await initDB();
  
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🏠 CESANTONI EXPERIENCE - Sistema QR Tracking       ║
║                                                       ║
║   Dashboard:  http://localhost:${PORT}                  ║
║   API Docs:   http://localhost:${PORT}/api              ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);

module.exports = app;
