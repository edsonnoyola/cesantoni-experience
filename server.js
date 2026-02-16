const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const QRCode = require('qrcode');
const fs = require('fs');
const { initDB, query, queryOne, run, scalar } = require('./database');
const { execSync } = require('child_process');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CRM_PASSWORD = process.env.CRM_PASSWORD || 'cesantoni2026';
const MANAGER_PHONE = process.env.MANAGER_PHONE || '5215610016226';

// Simple token store (in-memory, resets on restart)
const authTokens = new Set();

// Middleware
app.use(cors());
app.use(express.json());

// Auth middleware for CRM pages
function crmAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (authTokens.has(token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (password === CRM_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    authTokens.add(token);
    res.json({ token, username: username || 'admin' });
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' });
  }
});

// Public assets (landing, terra, etc)
app.use(express.static(path.join(__dirname, 'public')));

// Version/health check
app.get('/api/health', async (req, res) => res.json({ version: 'v8.0.0', commit: 'auth-assignment-inventory-list-daily-summary' }));

// Ensure directories exist
['uploads', 'public/videos', 'public/landings'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// Veo 3.1 config - usando API directa
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const LOGO_PATH = path.join(__dirname, 'public', 'logo-cesantoni.png');
// FFmpeg: usa el del sistema (Railway lo instala via nixpacks)
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Google Cloud Storage config
const GCS_BUCKET = process.env.GCS_BUCKET || 'cesantoni-videos';
const GCS_KEY_FILE = process.env.GCS_KEY_FILE; // Path to service account JSON
let gcsStorage = null;
let gcsBucket = null;

// Initialize GCS if credentials are available
if (GCS_KEY_FILE && fs.existsSync(GCS_KEY_FILE)) {
  try {
    gcsStorage = new Storage({ keyFilename: GCS_KEY_FILE });
    gcsBucket = gcsStorage.bucket(GCS_BUCKET);
    console.log('✅ Google Cloud Storage configurado:', GCS_BUCKET);
  } catch (err) {
    console.log('⚠️ Error configurando GCS:', err.message);
  }
} else if (process.env.GCS_CREDENTIALS) {
  // Alternative: credentials as JSON string in env var
  try {
    const credentials = JSON.parse(process.env.GCS_CREDENTIALS);
    gcsStorage = new Storage({ credentials });
    gcsBucket = gcsStorage.bucket(GCS_BUCKET);
    console.log('✅ Google Cloud Storage configurado (env):', GCS_BUCKET);
  } catch (err) {
    console.log('⚠️ Error configurando GCS:', err.message);
  }
} else {
  console.log('ℹ️ GCS no configurado - videos se guardarán localmente');
}

// Upload video to GCS
async function uploadToGCS(localPath, filename) {
  if (!gcsBucket) return null;

  try {
    const destination = `videos/${filename}`;
    await gcsBucket.upload(localPath, {
      destination,
      metadata: {
        contentType: 'video/mp4',
        cacheControl: 'public, max-age=31536000'
      }
    });

    // Make file public
    await gcsBucket.file(destination).makePublic();

    const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${destination}`;
    console.log('✅ Video subido a GCS:', publicUrl);
    return publicUrl;
  } catch (err) {
    console.log('⚠️ Error subiendo a GCS:', err.message);
    return null;
  }
}

// =====================================================
// API: PRODUCTOS
// =====================================================

app.get('/api/products', async (req, res) => {
  try {
    const { category, search, active } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (name ILIKE ? OR sku ILIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (active !== undefined) {
      sql += ' AND active = ?';
      params.push(active);
    }

    sql += ' ORDER BY name';
    const products = await query(sql, params);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await queryOne('SELECT * FROM products WHERE id = ?', [parseInt(req.params.id)]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/sku/:sku', async (req, res) => {
  try {
    const product = await queryOne('SELECT * FROM products WHERE sku = ?', [req.params.sku]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { sku, name, category, format, finish, type, resistance, water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, base_price } = req.body;
    
    const result = await run(`
      INSERT INTO products (sku, name, category, format, finish, type, resistance, water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, base_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`, [sku, name, category, format, finish, type, resistance, water_absorption, mohs, usage, pieces_per_box, sqm_per_box, weight_per_box, base_price]);

    res.json({ id: result.rows?.[0]?.id, message: 'Producto creado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
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
    await run(`UPDATE products SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Borrar video de un producto
app.delete('/api/products/:id/video', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const product = await queryOne('SELECT * FROM products WHERE id = ?', [productId]);
    
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    // Borrar archivo si existe
    if (product.video_url) {
      const videoPath = path.join(__dirname, 'public', product.video_url);
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
        console.log('🗑️ Video eliminado:', videoPath);
      }
    }
    
    // Actualizar DB
    await run('UPDATE products SET video_url = NULL WHERE id = ?', [productId]);
    
    res.json({ message: 'Video eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: DISTRIBUIDORES
// =====================================================

app.get('/api/distributors', async (req, res) => {
  try {
    const distributors = await query('SELECT * FROM distributors WHERE active = 1 ORDER BY name');
    res.json(distributors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/distributors/:id', async (req, res) => {
  try {
    const distributor = await queryOne('SELECT * FROM distributors WHERE id = ?', [parseInt(req.params.id)]);
    if (!distributor) return res.status(404).json({ error: 'Distribuidor no encontrado' });
    
    const stores = await query('SELECT * FROM stores WHERE distributor_id = ? AND active = 1', [parseInt(req.params.id)]);
    res.json({ ...distributor, stores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/distributors', async (req, res) => {
  try {
    const { name, slug, logo_url, website, contact_email, contact_phone } = req.body;
    const result = await run(`
      INSERT INTO distributors (name, slug, logo_url, website, contact_email, contact_phone)
      VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id`, [name, slug, logo_url, website, contact_email, contact_phone]);
    
    res.json({ id: result.rows?.[0]?.id, message: 'Distribuidor creado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/distributors/:id', async (req, res) => {
  try {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(req.params.id);
    await run(`UPDATE distributors SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ message: 'Distribuidor actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: TIENDAS
// =====================================================

app.get('/api/stores', async (req, res) => {
  try {
    const { state, distributor_id, slug } = req.query;
    let sql = `
      SELECT s.*, d.name as distributor_name 
      FROM stores s 
      JOIN distributors d ON s.distributor_id = d.id 
      WHERE s.active = 1
    `;
    const params = [];

    if (slug) {
      sql += ' AND s.slug = ?';
      params.push(slug);
    }
    if (state) {
      sql += ' AND s.state = ?';
      params.push(state);
    }
    if (distributor_id) {
      sql += ' AND s.distributor_id = ?';
      params.push(parseInt(distributor_id));
    }

    sql += ' ORDER BY s.state, s.city, s.name';
    const stores = await query(sql, params);
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stores/:id', async (req, res) => {
  try {
    const store = await queryOne(`
      SELECT s.*, d.name as distributor_name, d.slug as distributor_slug
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

app.post('/api/stores', async (req, res) => {
  try {
    const { distributor_id, name, slug, state, city, address, postal_code, lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount } = req.body;
    
    const result = await run(`
      INSERT INTO stores (distributor_id, name, slug, state, city, address, postal_code, lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`, [distributor_id, name, slug, state, city, address, postal_code, lat, lng, whatsapp, phone, email, manager_name, promo_text, promo_discount]);

    res.json({ id: result.rows?.[0]?.id, message: 'Tienda creada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/stores/:id', async (req, res) => {
  try {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'id') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(req.params.id);
    await run(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ message: 'Tienda actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: TRACKING
// =====================================================

app.post('/api/track/scan', async (req, res) => {
  try {
    const { product_id, store_id, session_id, utm_source, utm_medium, utm_campaign, source } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;
    const user_agent = req.headers['user-agent'] || '';
    const referrer = req.headers.referer || req.headers.referrer || '';

    // source puede ser 'qr' o 'nfc'
    const scan_source = source || 'qr';

    const result = await run(`
      INSERT INTO scans (product_id, store_id, session_id, ip_address, user_agent, referrer, utm_source, utm_medium, utm_campaign, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`, [product_id, store_id || null, session_id, ip_address, user_agent, referrer, utm_source || null, utm_medium || null, utm_campaign || null, scan_source]);

    res.json({ scan_id: result.rows?.[0]?.id, message: 'Escaneo registrado', source: scan_source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registrar escaneo QR/NFC
app.post('/api/scans', async (req, res) => {
  try {
    const { product_id, store_id, session_id, source, user_agent: ua, referrer: ref, utm_source, utm_medium, utm_campaign } = req.body;
    const ip_address = req.ip || req.connection?.remoteAddress || '';
    const user_agent = ua || req.headers['user-agent'] || '';
    const referrer = ref || req.headers.referer || req.headers.referrer || '';

    // source puede ser 'qr' o 'nfc'
    const scan_source = source || 'qr';

    // Validate required field
    if (!product_id) {
      return res.status(400).json({ error: 'product_id is required' });
    }

    const result = await run(`
      INSERT INTO scans (product_id, store_id, session_id, ip_address, user_agent, referrer, utm_source, utm_medium, utm_campaign, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [product_id, store_id || null, session_id || null, ip_address, user_agent, referrer, utm_source || null, utm_medium || null, utm_campaign || null, scan_source]);

    const scan_id = result?.lastInsertRowid || result?.changes || 1;
    res.json({ scan_id, message: 'Escaneo registrado', source: scan_source });
  } catch (err) {
    console.error('Error in /api/scans:', err);
    res.status(500).json({ error: err.message || err.toString() || 'Unknown error' });
  }
});

// Admin: borrar todos los scans (solo para testing)
app.delete('/api/admin/scans', async (req, res) => {
  try {
    await run('DELETE FROM scans');
    await run('DELETE FROM whatsapp_clicks');
    res.json({ message: 'Todos los scans y clicks borrados', success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/track/whatsapp', async (req, res) => {
  try {
    const { scan_id, product_id, store_id, session_id, whatsapp_number } = req.body;

    const result = await run(`
      INSERT INTO whatsapp_clicks (scan_id, product_id, store_id, session_id, whatsapp_number)
      VALUES (?, ?, ?, ?, ?)
     RETURNING id`, [scan_id || null, product_id, store_id || null, session_id, whatsapp_number || null]);

    res.json({ click_id: result.rows?.[0]?.id, message: 'Click registrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: ANALYTICS
// =====================================================

app.get('/api/analytics/overview', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    // KPIs básicos
    const total_scans = await scalar(`SELECT COUNT(*) FROM scans WHERE created_at >= NOW() - INTERVAL 'days days'`) || 0;
    const total_stores = await scalar('SELECT COUNT(*) FROM stores WHERE active = 1') || 0;
    const total_products = await scalar('SELECT COUNT(*) FROM products WHERE active = 1') || 0;
    const total_wa_clicks = await scalar(`SELECT COUNT(*) FROM whatsapp_clicks WHERE created_at >= NOW() - INTERVAL 'days days'`) || 0;
    const active_promos = await scalar('SELECT COUNT(*) FROM promotions WHERE active = 1') || 0;

    const conversion_rate = total_scans > 0
      ? ((total_wa_clicks / total_scans) * 100).toFixed(1)
      : 0;

    // Top productos
    const top_products = await query(`
      SELECT p.name as product_name, COUNT(s.id) as scans
      FROM scans s
      JOIN products p ON s.product_id = p.id
      WHERE s.created_at >= NOW() - INTERVAL 'days days'
      GROUP BY s.product_id
      ORDER BY scans DESC
      LIMIT 10
    `);

    // Top tiendas
    const top_stores = await query(`
      SELECT st.name as store_name, st.state, COUNT(s.id) as scans
      FROM scans s
      JOIN stores st ON s.store_id = st.id
      WHERE s.created_at >= NOW() - INTERVAL 'days days'
      GROUP BY s.store_id
      ORDER BY scans DESC
      LIMIT 10
    `);

    // Por estado (para el mapa heat)
    const by_state = await query(`
      SELECT st.state, COUNT(s.id) as scans
      FROM stores st
      LEFT JOIN scans s ON s.store_id = st.id AND s.created_at >= NOW() - INTERVAL 'days days'
      WHERE st.active = 1 AND st.state IS NOT NULL AND st.state != ''
      GROUP BY st.state
      ORDER BY scans DESC
    `);

    // Tendencia diaria (últimos 30 días)
    const daily = await query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM scans
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    res.json({
      total_scans,
      total_stores,
      total_products,
      total_wa_clicks,
      whatsapp_clicks: total_wa_clicks,
      active_stores: total_stores,
      active_promos,
      conversion_rate,
      top_products,
      top_stores,
      top_states: by_state,
      by_state,
      daily
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/by-state', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const data = await query(`
      SELECT 
        st.state,
        COUNT(DISTINCT st.id) as stores,
        COUNT(s.id) as scans,
        COUNT(w.id) as clicks,
        ROUND(CAST(COUNT(w.id) AS FLOAT) / MAX(COUNT(s.id), 1) * 100, 1) as conversion_rate
      FROM stores st
      LEFT JOIN scans s ON s.store_id = st.id AND s.created_at >= NOW() - INTERVAL 'days days'
      LEFT JOIN whatsapp_clicks w ON w.store_id = st.id AND w.created_at >= NOW() - INTERVAL 'days days'
      WHERE st.active = 1
      GROUP BY st.state
      ORDER BY scans DESC
    `);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/by-store', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const state = req.query.state;
    const limit = parseInt(req.query.limit) || 20;

    let sql = `
      SELECT
        st.id, st.name, st.state, st.city,
        d.name as distributor_name,
        COUNT(s.id) as scans,
        COUNT(w.id) as clicks
      FROM stores st
      JOIN distributors d ON st.distributor_id = d.id
      LEFT JOIN scans s ON s.store_id = st.id AND s.created_at >= NOW() - INTERVAL 'days days'
      LEFT JOIN whatsapp_clicks w ON w.store_id = st.id AND w.created_at >= NOW() - INTERVAL 'days days'
      WHERE st.active = 1
    `;
    const params = [];

    if (state) {
      sql += ' AND st.state = ?';
      params.push(state);
    }

    sql += ` GROUP BY st.id ORDER BY scans DESC LIMIT ?`;
    params.push(limit);

    res.json(await query(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analytics NFC vs QR
app.get('/api/analytics/by-source', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const data = await query(`
      SELECT
        COALESCE(source, 'qr') as source,
        COUNT(*) as scans,
        COUNT(DISTINCT product_id) as unique_products,
        COUNT(DISTINCT store_id) as unique_stores,
        COUNT(DISTINCT session_id) as unique_sessions
      FROM scans
      WHERE created_at >= NOW() - INTERVAL 'days days'
      GROUP BY source
      ORDER BY scans DESC
    `);

    // Totales
    const total_qr = data.find(d => d.source === 'qr')?.scans || 0;
    const total_nfc = data.find(d => d.source === 'nfc')?.scans || 0;
    const total = total_qr + total_nfc;

    res.json({
      by_source: data,
      summary: {
        total_scans: total,
        qr_scans: total_qr,
        nfc_scans: total_nfc,
        qr_percentage: total > 0 ? ((total_qr / total) * 100).toFixed(1) : 0,
        nfc_percentage: total > 0 ? ((total_nfc / total) * 100).toFixed(1) : 0
      }
    });
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

    const product = await queryOne('SELECT * FROM products WHERE id = ?', [parseInt(product_id)]);
    const store = await queryOne(`
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

    await run(`
      INSERT OR REPLACE INTO qr_codes (product_id, store_id, url, qr_data)
      VALUES (?, ?, ?, ?)
    `, [product_id, store_id, url, qrDataUrl]);

    res.json({ url, qr_data: qrDataUrl, product: product.name, store: store.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate QR as PNG image
app.get('/api/qr/img', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('url required');
    const buffer = await QRCode.toBuffer(url, {
      width: 400, margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('QR error');
  }
});

app.get('/api/qr/list', async (req, res) => {
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

    if (product_id) { sql += ' AND qr.product_id = ?'; params.push(parseInt(product_id)); }
    if (store_id) { sql += ' AND qr.store_id = ?'; params.push(parseInt(store_id)); }

    sql += ' ORDER BY qr.created_at DESC';
    res.json(await query(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: UTILIDADES
// =====================================================

app.get('/api/states', async (req, res) => {
  try {
    res.json(await query(`SELECT DISTINCT state, COUNT(*) as store_count FROM stores WHERE active = 1 GROUP BY state ORDER BY state`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    res.json(await query(`SELECT DISTINCT category, COUNT(*) as product_count FROM products WHERE active = 1 AND category IS NOT NULL GROUP BY category ORDER BY category`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: PROMOTIONS
app.get('/api/promotions', async (req, res) => {
  try {
    // Intentar obtener promociones si existe la tabla
    let promotions = [];
    try {
      promotions = await query(`
        SELECT p.*, pr.name as product_name, pr.sku as product_sku
        FROM promotions p
        LEFT JOIN products pr ON p.product_id = pr.id
        WHERE p.active = 1
        ORDER BY p.created_at DESC
      `);
    } catch (e) {
      // Tabla no existe, devolver array vacío
    }
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// LANDING PAGE DINÁMICO
// =====================================================

app.get('/p/:sku', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/landing/:slug', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/api/landing/:identifier', async (req, res) => {
  try {
    // Buscar por SKU o por slug
    const id = req.params.identifier;
    const product = await queryOne(
      'SELECT * FROM products WHERE sku ILIKE ? OR slug ILIKE ?',
      [id, id]
    );
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para el landing - obtiene producto + promoción
app.get('/api/promotions/for-product/:identifier', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    const { store_slug, state, distributor } = req.query;

    // Buscar producto por SKU o por slug
    const product = await queryOne(
      'SELECT * FROM products WHERE sku ILIKE ? OR slug ILIKE ?',
      [identifier, identifier]
    );
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    
    // Buscar promoción activa para este producto
    let promotion = null;
    let final_price = product.base_price || 0;
    let has_promotion = false;
    
    // Intentar encontrar promoción (si existe tabla promotions)
    try {
      promotion = await queryOne(`
        SELECT * FROM promotions 
        WHERE product_id = ? 
        AND active = 1 
        AND (start_date IS NULL OR start_date <= date('now'))
        AND (end_date IS NULL OR end_date >= date('now'))
        ORDER BY created_at DESC
        LIMIT 1
      `, [product.id]);
      
      if (promotion) {
        has_promotion = true;
        final_price = promotion.promo_price || final_price;
      }
    } catch (e) {
      // Tabla promotions no existe, continuar sin promoción
    }
    
    res.json({
      product,
      promotion,
      final_price,
      has_promotion
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// VIDEO GENERATION CON VEO 3.1
// =====================================================

app.post('/api/video/generate', async (req, res) => {
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY no configurado' });
  }
  
  const { product_id, product_name, image_url } = req.body;
  let { product_description } = req.body;

  // Buscar datos completos del producto en DB
  let dbProduct = null;
  if (product_id) {
    dbProduct = await queryOne('SELECT * FROM products WHERE id = ?', [product_id]);
    if (dbProduct && dbProduct.description && !product_description) {
      product_description = dbProduct.description;
      console.log('📝 Descripción obtenida de DB');
    }
  }
  const videoId = Date.now();
  const slug = (dbProduct?.slug || product_name || 'video').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  console.log('🎬 Generando video para:', product_name);
  res.json({ success: true, videoId, slug, message: 'Generando video...' });

  try {
    // Buscar imagen RENDER del cuarto (con el piso instalado) - NO la C1
    // Prioridad: Render_ de galería que coincida con producto > image_url principal
    let renderImageUrl = image_url;
    if (image_url) {
      console.log('🎯 Usando imagen explícita del request:', image_url);
    } else if (dbProduct && dbProduct.gallery) {
      try {
        const gallery = JSON.parse(dbProduct.gallery || '[]');
        const productNameClean = (product_name || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
        // Buscar render que coincida con el nombre del producto
        const renderImg = gallery.find(url => {
          const urlUpper = url.toUpperCase();
          const hasRender = urlUpper.includes('RENDER');
          const matchesName = urlUpper.includes(productNameClean) || urlUpper.includes(productNameClean.replace(/_/g, ''));
          const isFullSize = !url.includes('-150x') && !url.includes('-300x');
          return hasRender && matchesName && isFullSize;
        });
        if (renderImg) {
          renderImageUrl = renderImg;
          console.log('🎯 Usando render del cuarto:', renderImg);
        }
      } catch (e) {
        console.log('⚠️ Error parseando galería:', e.message);
      }
    }

    // Descargar imagen render y convertir a base64
    let imageBase64 = null;
    let imageMimeType = 'image/jpeg';

    if (renderImageUrl) {
      console.log('📥 Descargando render del cuarto:', renderImageUrl);
      try {
        const imgResponse = await fetch(renderImageUrl);
        const imgBuffer = await imgResponse.arrayBuffer();
        imageBase64 = Buffer.from(imgBuffer).toString('base64');

        if (renderImageUrl.includes('.png')) imageMimeType = 'image/png';
        else if (renderImageUrl.includes('.webp')) imageMimeType = 'image/webp';

        console.log('✅ Imagen descargada y convertida a base64');
      } catch (imgErr) {
        console.log('⚠️ No se pudo descargar imagen, continuando sin referencia:', imgErr.message);
      }
    }

    // Prompt: SOLO movimiento de cámara - la imagen ya tiene la escena completa
    let prompt = `Slow cinematic dolly forward. No text, no words, no titles, no overlays. Only camera movement over the existing scene.`;
    console.log('🎬 Prompt:', prompt);

    let result;
    try {
      // Image-to-video con API REST directa
      // Veo usa predictLongRunning, no generateVideos
      const requestBody = {
        instances: [{
          prompt: prompt
        }],
        parameters: {
          aspectRatio: "16:9",
          sampleCount: 1,
          negativePrompt: "text, letters, words, titles, logos, watermarks, captions, subtitles, overlays, typography, writing, people, humans"
        }
      };
      
      if (imageBase64) {
        console.log('🎯 Usando imagen como primer frame del video');
        console.log('📊 Tamaño imagen:', Math.round(imageBase64.length / 1024), 'KB');
        requestBody.instances[0].image = {
          bytesBase64Encoded: imageBase64,
          mimeType: imageMimeType
        };
      }
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${GOOGLE_API_KEY}`;
      console.log('🚀 Enviando request a Veo 2.0 API...');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      const responseText = await response.text();
      console.log('📡 Status:', response.status);
      
      if (!responseText) {
        throw new Error('Respuesta vacía del API');
      }
      
      try {
        result = JSON.parse(responseText);
      } catch (parseErr) {
        console.log('❌ Respuesta no es JSON:', responseText.substring(0, 500));
        throw new Error('Respuesta inválida del API');
      }
      
      if (result.error) {
        console.log('❌ Error API:', result.error.message);
        throw new Error(result.error.message);
      }
    } catch (apiErr) {
      console.log('❌ Error en Veo API:', apiErr.message);
      throw apiErr;
    }

    if (!result || !result.name) {
      console.log('❌ No se recibió operación válida:', JSON.stringify(result).substring(0, 200));
      throw new Error('No se recibió ID de operación');
    }

    console.log('✅ Operación:', result.name);

    let videoUri = null;
    for (let i = 0; i < 30; i++) {
      await sleep(10000);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${result.name}?key=${GOOGLE_API_KEY}`);
      const op = await response.json();
      
      if (op.done) {
        // Intentar diferentes estructuras de respuesta
        videoUri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
                   op.response?.videos?.[0]?.gcsUri ||
                   op.response?.generatedVideos?.[0]?.video?.uri;
        
        if (videoUri) {
          console.log('✅ Video generado:', videoUri);
        } else {
          console.log('⚠️ Respuesta completa:', JSON.stringify(op.response).substring(0, 500));
        }
        break;
      }
      console.log(`🔍 Verificando... (${i+1}/30)`);
    }

    if (!videoUri) {
      console.log('⏰ Timeout');
      return;
    }

    const tempPath = path.join(__dirname, 'public', 'videos', `temp_${videoId}.mp4`);
    const finalPath = path.join(__dirname, 'public', 'videos', `${slug}.mp4`);

    console.log('📥 Descargando video de Veo (incluye audio nativo)...');
    execSync(`curl -L -o "${tempPath}" "${videoUri}&key=${GOOGLE_API_KEY}"`);

    console.log('🎨 Agregando logo Cesantoni...');
    try {
      execSync(`${FFMPEG} -i "${tempPath}" -i "${LOGO_PATH}" -filter_complex "[1:v]scale=200:-1[logo];[0:v][logo]overlay=W-w-20:H-h-20" -c:a copy "${finalPath}" -y`);
      fs.unlinkSync(tempPath);
      console.log('✅ Logo agregado');
    } catch (ffmpegErr) {
      console.log('⚠️ FFmpeg error, usando video sin logo:', ffmpegErr.message);
      if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, finalPath);
      }
    }

    // Upload to GCS if available, otherwise keep local
    let finalVideoUrl = `/videos/${slug}.mp4`;

    if (gcsBucket) {
      const gcsUrl = await uploadToGCS(finalPath, `${slug}.mp4`);
      if (gcsUrl) {
        finalVideoUrl = gcsUrl;
        // Clean up local file after successful upload
        try { fs.unlinkSync(finalPath); } catch {}
      }
    }

    if (product_id) {
      await run('UPDATE products SET video_url = ? WHERE id = ?', [finalVideoUrl, product_id]);
    }

    console.log('✅ Video listo:', finalVideoUrl);
  } catch (error) {
    console.error('Error generando video:', error.message);
  }
});

app.get('/api/videos', async (req, res) => {
  try {
    const videosDir = path.join(__dirname, 'public', 'videos');
    if (!fs.existsSync(videosDir)) return res.json([]);
    const videos = fs.readdirSync(videosDir)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('temp_'))
      .map(v => ({ name: v.replace('.mp4', ''), url: `/videos/${v}` }));
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tables are created in database.js initDB()
const createLandingsTable = () => {};

app.get('/api/landings', async (req, res) => {
  try {
    createLandingsTable();
    const landings = await query(`
      SELECT l.*, p.name as product_name, p.sku as product_sku, p.image_url as product_image
      FROM landings l
      JOIN products p ON l.product_id = p.id
      ORDER BY l.updated_at DESC
    `);
    res.json(landings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// LANDINGS DATABASE CRUD
// =====================================================

// GET all landings
app.get('/api/landings/db', async (req, res) => {
  try {
    createLandingsTable();
    const landings = await query(`
      SELECT l.*, p.name as product_name, p.sku as product_sku, p.image_url as product_image
      FROM landings l
      JOIN products p ON l.product_id = p.id
      ORDER BY l.updated_at DESC
    `);
    res.json(landings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single landing
app.get('/api/landings/db/:id', async (req, res) => {
  try {
    const landing = await queryOne(`
      SELECT l.*, p.name as product_name, p.sku as product_sku, p.image_url as product_image
      FROM landings l
      JOIN products p ON l.product_id = p.id
      WHERE l.id = ?
    `, [req.params.id]);
    if (!landing) return res.status(404).json({ error: 'Landing not found' });
    res.json(landing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET landing by product SKU (for landing.html)
app.get('/api/landings/by-product/:sku', async (req, res) => {
  try {
    createLandingsTable();
    const landing = await queryOne(`
      SELECT l.*, p.name as product_name, p.sku as product_sku, p.image_url as product_image
      FROM landings l
      JOIN products p ON l.product_id = p.id
      WHERE p.sku = ? AND l.active = 1
    `, [req.params.sku]);
    if (!landing) return res.status(404).json({ error: 'Landing not found' });
    res.json(landing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create landing
app.post('/api/landings', async (req, res) => {
  try {
    createLandingsTable();
    const { product_id, title, description, promo_text, video_url, image_url } = req.body;
    
    // Check if landing already exists for this product
    const existing = await queryOne('SELECT id FROM landings WHERE product_id = ?', [product_id]);
    
    if (existing) {
      // Update existing
      await run(`UPDATE landings SET title=?, description=?, promo_text=?, video_url=?, image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [title, description, promo_text, video_url, image_url, existing.id]);
      res.json({ success: true, id: existing.id, updated: true });
    } else {
      // Create new
      const insertResult = await run(`INSERT INTO landings (product_id, title, description, promo_text, video_url, image_url) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        [product_id, title, description, promo_text, video_url, image_url]);
      const newId = insertResult.rows?.[0]?.id;
      res.json({ success: true, id: newId, created: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update landing
app.put('/api/landings/:id', async (req, res) => {
  try {
    const { title, description, promo_text, video_url, image_url, active } = req.body;
    await run(`UPDATE landings SET title=?, description=?, promo_text=?, video_url=?, image_url=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [title, description, promo_text, video_url, image_url, active ?? 1, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE landing
app.delete('/api/landings/:id', async (req, res) => {
  try {
    await run('DELETE FROM landings WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// SAMPLE REQUESTS - Solicitudes de muestra
// =====================================================

// Create sample request
app.post('/api/samples', async (req, res) => {
  try {
    const { product_id, product_name, store_id, store_name, customer_name, customer_phone, customer_email, address } = req.body;

    // Table created in database.js initDB()

    const result = await run(`INSERT INTO sample_requests (product_id, product_name, store_id, store_name, customer_name, customer_phone, customer_email, address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [product_id, product_name, store_id, store_name, customer_name, customer_phone, customer_email, address]
    );

    res.json({ success: true, id: result.rows?.[0]?.id });
  } catch (err) {
    console.error('Sample request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List sample requests (admin)
app.get('/api/samples', async (req, res) => {
  try {
    const samples = await query(`SELECT * FROM sample_requests ORDER BY created_at DESC`);
    res.json(samples);
  } catch (err) {
    res.json([]); // Table might not exist yet
  }
});

// Update sample request status
app.put('/api/samples/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    await run(`UPDATE sample_requests SET status = ?, notes = ? WHERE id = ?`, [status, notes, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// QUOTES - Cotizaciones
// =====================================================

// Create quote
app.post('/api/quotes', async (req, res) => {
  try {
    const { product_id, product_name, product_sku, m2, price_per_m2, total, store_id, store_name, customer_name, customer_email, customer_phone } = req.body;

    // Table created in database.js initDB()

    const result = await run(`INSERT INTO quotes (product_id, product_name, product_sku, m2, price_per_m2, total, store_id, store_name, customer_name, customer_email, customer_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [product_id, product_name, product_sku, m2, price_per_m2, total, store_id, store_name, customer_name, customer_email, customer_phone]
    );

    // In a real implementation, you would send an email here
    // For now, just store the quote

    res.json({ success: true, id: result.rows?.[0]?.id });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List quotes (admin)
app.get('/api/quotes', async (req, res) => {
  try {
    const quotes = await query(`SELECT * FROM quotes ORDER BY created_at DESC`);
    res.json(quotes);
  } catch (err) {
    res.json([]); // Table might not exist yet
  }
});

// =====================================================
// REVIEWS - Opiniones
// =====================================================

// Create review
app.post('/api/reviews', async (req, res) => {
  try {
    const { product_id, store_id, rating, comment, customer_name } = req.body;

    // Table created in database.js initDB()

    const result = await run(`INSERT INTO reviews (product_id, store_id, rating, comment, customer_name)
      VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [product_id, store_id, rating, comment, customer_name]
    );

    res.json({ success: true, id: result.rows?.[0]?.id });
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get reviews for product
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const reviews = await query(`SELECT * FROM reviews WHERE product_id = ? AND approved = 1 ORDER BY created_at DESC`, [req.params.id]);

    // Calculate average
    const avgResult = await queryOne(`SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE product_id = ? AND approved = 1`, [req.params.id]);

    res.json({
      reviews,
      average: avgResult?.avg_rating ? Math.round(avgResult.avg_rating * 10) / 10 : 0,
      count: avgResult?.count || 0
    });
  } catch (err) {
    res.json({ reviews: [], average: 0, count: 0 });
  }
});

// =====================================================
// TERRA - Asistente de Voz Figital
// =====================================================

app.get('/terra', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terra.html'));
});

// Terra conversations - MUST be before POST /api/terra
app.get('/api/terra/conversations', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const rows = await query(`
      SELECT id, session_id, customer_name, store_name, product_name, question, answer, intent, created_at
      FROM terra_conversations
      WHERE created_at >= NOW() - (? || ' days')::INTERVAL
      ORDER BY created_at DESC
      LIMIT 500
    `, [days]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/terra/summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const rows = await query(`
      SELECT customer_name, store_name, product_name, question, intent, created_at
      FROM terra_conversations
      WHERE created_at >= NOW() - (? || ' days')::INTERVAL
      ORDER BY created_at DESC
      LIMIT 200
    `, [days]);

    if (rows.length === 0) {
      return res.json({ summary: 'No hay conversaciones en los últimos ' + days + ' días.', total: 0, conversations: [] });
    }

    const total = rows.length;
    const uniqueCustomers = new Set(rows.filter(r => r.customer_name).map(r => r.customer_name)).size;
    const topProducts = {};
    rows.forEach(r => { if (r.product_name) topProducts[r.product_name] = (topProducts[r.product_name] || 0) + 1; });
    const topStores = {};
    rows.forEach(r => { if (r.store_name) topStores[r.store_name] = (topStores[r.store_name] || 0) + 1; });

    const questions = rows.map(r => `[${r.customer_name || 'Anónimo'}${r.product_name ? ' sobre ' + r.product_name : ''}]: ${r.question}`).join('\n');

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `Analiza estas ${total} preguntas de clientes al asistente Terra de Cesantoni (pisos porcelanato premium). Dame un resumen ejecutivo en español:\n\n1. **Temas más preguntados** (top 5)\n2. **Productos más consultados** (top 5)\n3. **Preocupaciones principales** de los clientes\n4. **Oportunidades de venta**\n5. **Insight no obvio**\n\nPreguntas:\n${questions}\n\nResponde conciso, con bullets. Máximo 300 palabras.` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
        })
      }
    );
    const aiData = await aiRes.json();
    const summary = aiData.candidates?.[0]?.content?.parts?.[0]?.text || 'No se pudo generar resumen.';

    res.json({
      summary, total, unique_customers: uniqueCustomers, days,
      top_products: Object.entries(topProducts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
      top_stores: Object.entries(topStores).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      recent: rows.slice(0, 20)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// TERRA SESSIONS - Store Mode Tracking
// =====================================================

app.post('/api/terra/session', async (req, res) => {
  try {
    const { action, session_id, customer_name, store_id, store_name, product } = req.body;

    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    if (action === 'start') {
      // Create or update session
      const existing = await queryOne('SELECT id FROM terra_sessions WHERE session_id = ?', [session_id]);
      if (existing) {
        await run('UPDATE terra_sessions SET customer_name = ?, store_id = ?, store_name = ? WHERE session_id = ?',
          [customer_name, store_id || null, store_name || null, session_id]);
      } else {
        await run('INSERT INTO terra_sessions (session_id, customer_name, store_id, store_name, products_visited) VALUES (?, ?, ?, ?, ?)',
          [session_id, customer_name, store_id || null, store_name || null, '[]']);
      }
      return res.json({ success: true });
    }

    if (action === 'scan_product') {
      const session = await queryOne('SELECT * FROM terra_sessions WHERE session_id = ?', [session_id]);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      let visited = [];
      try { visited = JSON.parse(session.products_visited || '[]'); } catch (e) {}

      if (product && !visited.find(v => v.id === product.id)) {
        visited.push({
          id: product.id,
          name: product.name,
          category: product.category,
          scanned_at: new Date().toISOString()
        });
        await run('UPDATE terra_sessions SET products_visited = ?, conversation_count = conversation_count + 1 WHERE session_id = ?',
          [JSON.stringify(visited), session_id]);
      }
      return res.json({ success: true, products_count: visited.length });
    }

    if (action === 'end') {
      const session = await queryOne('SELECT * FROM terra_sessions WHERE session_id = ?', [session_id]);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const startedAt = new Date(session.started_at);
      const durationMin = (Date.now() - startedAt.getTime()) / 60000;

      await run('UPDATE terra_sessions SET ended_at = CURRENT_TIMESTAMP, duration_minutes = ? WHERE session_id = ?',
        [Math.round(durationMin * 10) / 10, session_id]);
      return res.json({ success: true, duration_minutes: durationMin });
    }

    if (action === 'whatsapp_sent') {
      await run('UPDATE terra_sessions SET whatsapp_sent = 1 WHERE session_id = ?', [session_id]);
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('Terra session error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/terra/sessions', async (req, res) => {
  try {
    await run('DELETE FROM terra_sessions');
    res.json({ success: true, message: 'All sessions deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/terra/sessions', async (req, res) => {
  try {
    const { store, days, limit: lim } = req.query;
    const d = parseInt(days) || 30;
    const l = parseInt(lim) || 100;

    let sql = `SELECT * FROM terra_sessions WHERE started_at >= NOW() - INTERVAL '${d} days'`;
    const params = [];

    if (store) {
      sql += ' AND store_name ILIKE ?';
      params.push(`%${store}%`);
    }

    sql += ' ORDER BY started_at DESC LIMIT ?';
    params.push(l);

    const sessions = await query(sql, params);

    // Summary stats
    const total = sessions.length;
    const avgProducts = total > 0 ? sessions.reduce((sum, s) => {
      try { return sum + JSON.parse(s.products_visited || '[]').length; } catch (e) { return sum; }
    }, 0) / total : 0;
    const avgDuration = total > 0 ? sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0) / total : 0;
    const whatsappSent = sessions.filter(s => s.whatsapp_sent).length;

    res.json({
      sessions,
      summary: {
        total_sessions: total,
        avg_products_per_visit: Math.round(avgProducts * 10) / 10,
        avg_duration_minutes: Math.round(avgDuration * 10) / 10,
        whatsapp_sent: whatsappSent,
        whatsapp_rate: total > 0 ? Math.round((whatsappSent / total) * 100) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI-powered WhatsApp summary
app.post('/api/terra/whatsapp-summary', async (req, res) => {
  try {
    const { customer_name, store_name, visited_products, conversation_highlights, session_id } = req.body;

    if (!visited_products || visited_products.length === 0) {
      return res.status(400).json({ error: 'No products visited' });
    }

    const baseUrl = BASE_URL;

    // Generate AI recommendation
    let recommendation = '';
    if (GOOGLE_API_KEY) {
      try {
        const productList = visited_products.map((p, i) =>
          `${i + 1}. ${p.name} | ${p.category || 'Premium'} | ${p.format || ''} | PEI ${p.pei || 'N/A'} | ${p.finish || ''} | ${p.usage || ''}`
        ).join('\n');

        const aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `El cliente ${customer_name} visitó ${store_name || 'Cesantoni'} y vio estos pisos:\n${productList}\n\n${conversation_highlights ? 'Contexto de la conversación: ' + conversation_highlights : ''}\n\nGenera UNA recomendación personalizada en 1-2 oraciones cortas en español mexicano. Menciona por qué un piso específico le conviene basándote en las características técnicas. Sé directo y útil.` }] }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 150 }
            })
          }
        );
        const aiData = await aiRes.json();
        recommendation = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (e) {
        console.log('AI recommendation error:', e.message);
      }
    }

    // Build WhatsApp message
    let msg = `*Hola! Soy ${customer_name}*\n`;
    msg += `Visite ${store_name || 'Cesantoni'} con Terra, mi guia de Cesantoni.\n\n`;
    msg += `*Mis pisos favoritos:*\n\n`;

    visited_products.forEach((p, i) => {
      msg += `${i + 1}. *${p.name}* | ${p.category || 'Premium'} | ${p.format || ''}\n`;
      msg += `   Ver: ${baseUrl}/p/${p.slug || p.sku || p.id}\n\n`;
    });

    if (recommendation) {
      msg += `*Recomendacion de Terra:*\n${recommendation}\n\n`;
    }

    msg += `Me gustaria recibir una cotizacion!`;

    // Mark session as WhatsApp sent
    if (session_id) {
      try {
        await run('UPDATE terra_sessions SET whatsapp_sent = 1, recommendation = ? WHERE session_id = ?',
          [recommendation, session_id]);
      } catch (e) {}
    }

    res.json({ message: msg, recommendation });
  } catch (err) {
    console.error('WhatsApp summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/terra', async (req, res) => {
  try {
    const { message, customer_name, customer_gender, store_name, current_product_id, visited_products, visited_products_detail, history, store_mode } = req.body;

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'API no configurada' });
    }

    // Get current product context if viewing one
    let currentProduct = null;
    if (current_product_id) {
      currentProduct = await queryOne('SELECT * FROM products WHERE id = ?', [parseInt(current_product_id)]);
    }

    const clientName = customer_name || 'cliente';
    const visitedCount = visited_products ? visited_products.length : 0;

    // Smart catalog: only send relevant products to reduce tokens
    let catalogText = '';
    if (currentProduct) {
      const related = await query(`
        SELECT id, name, category, format, finish, pei, usage
        FROM products WHERE active = 1 AND category = ? AND id != ? LIMIT 15
      `, [currentProduct.category, currentProduct.id]);
      catalogText = related.map(p =>
        `ID:${p.id}|${p.name}|${p.category}|F:${p.format||''}|PEI:${p.pei||''}|A:${p.finish||''}|U:${p.usage||''}`
      ).join('\n');
    } else {
      const products = await query(`
        SELECT id, name, category, format, finish, pei, usage
        FROM products WHERE active = 1 ORDER BY name
      `);
      catalogText = products.map(p =>
        `ID:${p.id}|${p.name}|${p.category||'PREMIUM'}|PEI:${p.pei||''}|A:${p.finish||''}|U:${p.usage||''}`
      ).join('\n');
    }

    const productContext = currentProduct ? `
PRODUCTO ACTUAL: ${currentProduct.name} | Cat:${currentProduct.category} | Tipo:${currentProduct.type} | Formato:${currentProduct.format} | Acabado:${currentProduct.finish} | PEI:${currentProduct.pei} | Absorcion:${currentProduct.water_absorption||'porcelanico'} | Mohs:${currentProduct.mohs||'N/A'} | Uso:${currentProduct.usage} | ${currentProduct.description||'Piso premium'}` : '';

    // Rich visited products context (Phase 2c)
    let visitedContext = 'Ninguno';
    if (visited_products_detail && visited_products_detail.length > 0) {
      visitedContext = 'PISOS VISTOS POR EL CLIENTE:\n' + visited_products_detail.map((p, i) =>
        `${i + 1}. ${p.name} | ${p.category || 'Premium'} | ${p.format || ''} | PEI ${p.pei || 'N/A'} | ${p.finish || ''} | ${p.usage || ''}`
      ).join('\n');
    } else if (visited_products && visited_products.length > 0) {
      visitedContext = visited_products.join(', ');
    }

    // Store-guide mode instructions (Phase 2d)
    let modeInstruction = '';
    if (store_mode) {
      if (visitedCount === 0 && !currentProduct) {
        modeInstruction = `MODO GUIA: El cliente acaba de llegar a la tienda y AUN NO ha escaneado ningun piso. NO hagas preguntas, se directa y breve. Dile algo como: "Bienvenido/a! Recorre la tienda tranquilamente, escanea el QR de cualquier piso que te llame la atencion y yo te cuento todo sobre el: si aguanta mascotas, si va para tu espacio, como se limpia... lo que necesites saber! Anda, ve a explorar." Dale confianza para recorrer la tienda, no lo interrogues.`;
      } else if (visitedCount === 1 || (visitedCount === 0 && currentProduct)) {
        modeInstruction = `MODO PRODUCTO: El cliente esta viendo un piso. Presentalo, explica sus mejores cualidades de forma simple, y pregunta si quiere ver mas opciones o tiene dudas.`;
      } else if (visitedCount >= 2) {
        modeInstruction = `MODO COMPARACION: El cliente ya vio ${visitedCount} pisos. Puedes comparar caracteristicas entre ellos, recomendar cual es mejor segun sus necesidades. Menciona diferencias especificas (PEI, acabado, uso).`;
      }
      if (visitedCount >= 3) {
        modeInstruction += ` PROACTIVO: Sugiere enviar resumen por WhatsApp si no lo ha pedido. Di algo como "Ya llevas ${visitedCount} pisos, quieres que te mande el resumen por WhatsApp?"`;
      }
    }

    const systemPrompt = `Eres Terra, la amiga experta en pisos de Cesantoni. Eres como esa amiga que sabe TODO de decoracion y pisos y te ayuda con mucho gusto.

PERSONALIDAD:
- Calida, amena, platicadora. Como una amiga que te guia por la tienda.
- Hablas en espanol mexicano natural y relajado (pero no vulgar).
- Te ENCANTA ayudar a la gente a encontrar su piso perfecto.
- Explicas las cosas tecnicas de forma SIMPLE: en vez de "PEI 4" dices "aguanta mucho trafico, perfecto para que no se raye".
- Eres entusiasta cuando recomiendas: "Este te va a ENCANTAR", "Mira, este es increible para lo que buscas".
- NO hagas muchas preguntas seguidas. Mejor da informacion util y deja que el cliente pregunte.
- Se breve y directa. Estas en una tienda, no en un email.

Cliente: ${clientName} (${customer_gender === 'f' ? 'mujer, usa femenino: bienvenida/lista/conectada' : 'hombre, usa masculino: bienvenido/listo/conectado'}). ${store_name ? 'Tienda: '+store_name : ''}
${modeInstruction}

CONOCIMIENTO (usa para responder pero explicalo simple):
PEI: 1=decorativo, 2=poco trafico, 3=toda la casa, 4=comercios/mucho trafico, 5=industrial.
Absorcion: <0.5%=impermeable(exterior/bano), 0.5-3%=resistente, >3%=solo interior seco.
Acabados: Mate=no resbala,facil limpiar. Brillante=elegante,amplifica espacio. Texturizado=exterior/alberca.
Porcelanico=el mas resistente. Pasta blanca=calidad exportacion,colores mas vivos.
Limpieza: Agua+jabon. Mate=lo mas facil. Brillante=microfibra. NUNCA acido muriatico.
Cesantoni: Empresa mexicana premium, tecnologia HD, gran formato, garantia.
vs Madera real: no se hincha, resiste agua, cero mantenimiento, mismo look. vs Marmol: no se mancha, sin sellado.
${productContext}

VISTOS: ${visitedContext}

CATALOGO:
${catalogText}

RESPUESTA: MAXIMO 2-3 oraciones cortas. Menciona producto si aplica. Usa nombre ${clientName}. Traduce tecnico a simple. No repitas vistos. NO hagas mas de 1 pregunta por respuesta, y solo si es necesario.

IMPORTANTE: Responde UNICAMENTE un objeto JSON valido. NADA de texto antes ni despues del JSON. SOLO el JSON.
Formato EXACTO: {"intent":"recommend|lookup|question|greeting","speech":"MAXIMO 40 PALABRAS","product_id":null,"action":"show_product|none"}`;

    // Build conversation with history for context
    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: '{"intent":"greeting","speech":"Listo, soy Terra.","product_id":null,"action":"none"}' }] }
    ];

    // Add conversation history (last 6 exchanges for memory)
    if (history && history.length > 0) {
      const recent = history.slice(-6);
      for (const h of recent) {
        contents.push({ role: 'user', parts: [{ text: h.user }] });
        if (h.terra) contents.push({ role: 'model', parts: [{ text: h.terra }] });
      }
    }

    // Current message
    contents.push({ role: 'user', parts: [{ text: message }] });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 200
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error('Terra Gemini error:', data.error);
      return res.json({ speech: 'Disculpa, tuve un problema. Podrias repetir tu pregunta?', intent: 'error', product: null, action: 'none' });
    }

    const rawReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from Gemini response — handle multiple formats
    let parsed;
    try {
      // Clean potential markdown wrapping
      const cleaned = rawReply.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Try to extract JSON object from mixed text+JSON response
      const jsonMatch = rawReply.match(/\{[\s\S]*"speech"\s*:\s*"[^"]*"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
          console.log('Terra: extracted JSON from mixed response');
        } catch (e2) {
          // Extract just the speech value with regex
          const speechMatch = rawReply.match(/"speech"\s*:\s*"([^"]*)"/);
          if (speechMatch) {
            parsed = { intent: 'question', speech: speechMatch[1], product_id: null, action: 'none' };
          } else {
            // Last resort: use plain text before JSON
            const plainText = rawReply.replace(/\{[\s\S]*\}/, '').trim();
            console.log('Terra parse error, raw:', rawReply.substring(0, 300));
            parsed = { intent: 'question', speech: plainText || rawReply.substring(0, 200), product_id: null, action: 'none' };
          }
        }
      } else {
        console.log('Terra parse error, raw:', rawReply.substring(0, 300));
        parsed = { intent: 'question', speech: rawReply.substring(0, 200), product_id: null, action: 'none' };
      }
    }

    // If there's a product_id, fetch the full product
    let productData = null;
    if (parsed.product_id) {
      productData = await queryOne('SELECT id, name, slug, sku, category, type, format, finish, image_url FROM products WHERE id = ?', [parseInt(parsed.product_id)]);
    }

    // Log conversation to terra_conversations
    try {
      await run(`INSERT INTO terra_conversations (session_id, customer_name, store_name, product_id, product_name, question, answer, intent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.body.session_id || null, customer_name || null, store_name || null,
         current_product_id || null, currentProduct?.name || null,
         message, parsed.speech || '', parsed.intent || 'question']);
    } catch (e) { console.log('Terra log error:', e.message); }

    const speechText = parsed.speech || 'Disculpa, no entendi bien. Podrias decirlo de otra forma?';

    // Fire TTS in background, but don't wait — respond immediately with text
    preGenerateTTS(speechText);

    res.json({
      intent: parsed.intent || 'question',
      speech: speechText,
      product: productData,
      action: parsed.action || 'none'
    });

  } catch (err) {
    console.error('Terra error:', err);
    res.json({ speech: 'Hubo un error de conexion. Intenta de nuevo.', intent: 'error', product: null, action: 'none' });
  }
});

// =====================================================
// TTS - Gemini 2.5 Flash TTS with pre-generation cache
// =====================================================

// Pre-generation cache: terra AI response fires TTS in advance
const ttsCache = new Map();

function preGenerateTTS(text) {
  if (!GOOGLE_API_KEY || !text) return;
  const key = text.substring(0, 100);
  const promise = fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text.substring(0, 300) }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          }
        }
      })
    }
  ).then(r => r.json()).then(data => {
    if (data.error) return null;
    return data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  }).catch(() => null);

  ttsCache.set(key, { promise, timestamp: Date.now() });

  // Clean old entries (>60s)
  for (const [k, v] of ttsCache) {
    if (Date.now() - v.timestamp > 60000) ttsCache.delete(k);
  }
}

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Texto requerido' });
    }

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'API no configurada', fallback: true });
    }

    // Check pre-generation cache first
    const key = text.substring(0, 100);
    const cached = ttsCache.get(key);
    if (cached) {
      ttsCache.delete(key);
      const audioData = await cached.promise;
      if (audioData) {
        return res.json({ audioContent: audioData, format: 'pcm' });
      }
    }

    // No cache hit — generate now
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text.substring(0, 300) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
            }
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error('TTS error:', JSON.stringify(data.error));
      return res.status(500).json({ error: 'TTS no disponible', fallback: true });
    }

    const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      return res.status(500).json({ error: 'No audio generated', fallback: true });
    }

    res.json({ audioContent: audioData, format: 'pcm' });

  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: 'Error TTS', fallback: true });
  }
});

// =====================================================
// WHATSAPP BOT - Meta Cloud API + Gemini
// =====================================================

const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '663552990169738';
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'cesantoni2026';
const WA_FORWARD_URL = process.env.WA_FORWARD_URL || '';

// Send WhatsApp text message
async function sendWhatsApp(to, text) {
  if (!WA_TOKEN) { console.log('⚠️ WA_TOKEN not set'); return null; }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
    });
    const data = await res.json();
    if (data.error) console.error('WA send error:', data.error);
    else try { await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [to, 'assistant', text]); } catch(e) {}
    return data;
  } catch (err) {
    console.error('WA send error:', err.message);
    return null;
  }
}

// Send WhatsApp image message
async function sendWhatsAppImage(to, imageUrl, caption) {
  if (!WA_TOKEN) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'image', image: { link: imageUrl, caption } })
    });
    const data = await res.json();
    if (!data.error) try { await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [to, 'assistant', `[Imagen] ${caption || ''}`]); } catch(e) {}
    return data;
  } catch (err) {
    console.error('WA image error:', err.message);
    return null;
  }
}

// Send WhatsApp interactive buttons
async function sendWhatsAppButtons(to, body, buttons) {
  if (!WA_TOKEN) return null;
  try {
    const btnLabels = buttons.map(b => b.title).join(' | ');
    const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.map((b, i) => ({
              type: 'reply',
              reply: { id: b.id || `btn_${i}`, title: b.title }
            }))
          }
        }
      })
    });
    const data = await res.json();
    if (data.error) console.error('WA buttons error:', data.error);
    else try { await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [to, 'assistant', `${body}\n[Botones: ${btnLabels}]`]); } catch(e) {}
    return data;
  } catch (err) {
    console.error('WA buttons error:', err.message);
    return null;
  }
}

// Send WhatsApp interactive list message (up to 10 items in sections)
async function sendWhatsAppList(to, body, buttonText, sections) {
  if (!WA_TOKEN) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: buttonText,
            sections: sections.map(s => ({
              title: s.title,
              rows: s.rows.map(r => ({ id: r.id, title: r.title.substring(0, 24), description: (r.description || '').substring(0, 72) }))
            }))
          }
        }
      })
    });
    const data = await res.json();
    if (data.error) console.error('WA list error:', data.error);
    else try { await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [to, 'assistant', `${body}\n[Lista: ${buttonText}]`]); } catch(e) {}
    return data;
  } catch (err) {
    console.error('WA list error:', err.message);
    return null;
  }
}

// Lead scoring: update score on key actions
async function addLeadScore(phone, points, action) {
  try {
    await run('UPDATE leads SET score = COALESCE(score, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE phone = ?', [points, phone]);
    console.log(`   📊 Score +${points} (${action}) for ${phone}`);
  } catch(e) { /* ignore if no lead */ }
}

// Send WhatsApp template message (for contacting users outside 24hr window)
async function sendWhatsAppTemplate(to, templateName, params = []) {
  if (!WA_TOKEN) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: {
          name: templateName,
          language: { code: 'es_MX' },
          components: params.length > 0 ? [{
            type: 'body',
            parameters: params.map(p => ({ type: 'text', text: String(p) }))
          }] : []
        }
      })
    });
    const data = await res.json();
    if (data.error) {
      console.error('WA template error:', JSON.stringify(data.error));
      return { error: data.error };
    }
    try { await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [to, 'assistant', `[Template: ${templateName}] ${params.join(' | ')}`]); } catch(e) {}
    return data;
  } catch (err) {
    console.error('WA template error:', err.message);
    return null;
  }
}

// Download media from WhatsApp (audio, image)
async function downloadWhatsAppMedia(mediaId) {
  try {
    // Step 1: Get media URL
    const urlRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
    });
    const urlData = await urlRes.json();
    if (!urlData.url) return null;

    // Step 2: Download the actual file
    const fileRes = await fetch(urlData.url, {
      headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
    });
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, mimeType: urlData.mime_type || 'application/octet-stream' };
  } catch (e) {
    console.error('Media download error:', e.message);
    return null;
  }
}

// Transcribe audio using Gemini
async function transcribeAudio(audioBuffer, mimeType) {
  try {
    const base64 = audioBuffer.toString('base64');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: mimeType || 'audio/ogg', data: base64 } },
              { text: 'Transcribe este audio a texto exacto en español. Solo responde la transcripción, nada más.' }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
        })
      }
    );
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    console.error('Transcription error:', e.message);
    return null;
  }
}

// Analyze image using Gemini Vision
async function analyzeFloorImage(imageBuffer, mimeType) {
  try {
    const base64 = imageBuffer.toString('base64');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
              { text: `Analiza esta imagen de piso/azulejo. Describe brevemente:
1. Tipo de apariencia (madera, mármol, piedra, cemento, etc.)
2. Color predominante (claro, oscuro, gris, beige, etc.)
3. Acabado probable (mate, pulido, texturizado)
4. Formato estimado (grande, mediano, pequeño)
Responde en JSON: {"look":"madera","color":"claro","finish":"mate","format":"grande"}
Solo el JSON, nada más.` }
            ]
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
        })
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const jsonMatch = text.match(/\{[^}]+\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    console.error('Image analysis error:', e.message);
    return null;
  }
}

// Generate PDF quote
async function generateQuotePDF(product, m2, lead) {
  const boxes = product.sqm_per_box ? Math.ceil(m2 / product.sqm_per_box) : null;
  const totalM2 = boxes ? (boxes * product.sqm_per_box).toFixed(2) : m2;
  const total = product.base_price ? Math.round(parseFloat(totalM2) * product.base_price) : null;
  const piecesTotal = boxes && product.pieces_per_box ? boxes * product.pieces_per_box : null;

  // Generate simple HTML quote that can be converted
  const date = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const html = `
COTIZACIÓN CESANTONI
${date}
${'═'.repeat(40)}

Cliente: ${lead?.name || 'Cliente'}
Producto: ${product.name}
SKU: ${product.sku || ''}

DETALLES:
• Formato: ${product.format || 'Gran formato'}
• Acabado: ${product.finish || 'Premium'}
• PEI: ${product.pei || 'N/A'}
• Uso: ${product.usage || 'Interior/Exterior'}

COTIZACIÓN:
• Área solicitada: ${m2} m²
${boxes ? `• Cajas necesarias: ${boxes} (${totalM2} m² reales)` : ''}
${piecesTotal ? `• Piezas totales: ${piecesTotal}` : ''}
• Precio por m²: $${product.base_price || '?'}
${total ? `• TOTAL ESTIMADO: $${total.toLocaleString('es-MX')} MXN` : ''}

${'─'.repeat(40)}
Precios sujetos a cambio sin previo aviso.
Incluye material extra por cortes.
Vigencia: 15 días.

Cesantoni · cesantoni.com.mx
  `.trim();

  return html;
}

// Send WhatsApp document
async function sendWhatsAppDocument(to, documentUrl, filename, caption) {
  if (!WA_TOKEN) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { link: documentUrl, filename, caption } })
    });
    const data = await res.json();
    if (!data.error) try { await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [to, 'assistant', `[Documento] ${filename}`]); } catch(e) {}
    return data;
  } catch (err) {
    console.error('WA document error:', err.message);
    return null;
  }
}

// Mark message as read
async function markAsRead(messageId) {
  if (!WA_TOKEN) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId })
    });
  } catch (e) {}
}

// WhatsApp bot - process incoming message with Gemini
async function processWhatsAppMessage(from, text, customerName) {
  // Get conversation history
  const history = await query(
    'SELECT role, message FROM wa_conversations WHERE phone = ? ORDER BY created_at DESC LIMIT 10',
    [from]
  ).reverse();

  // Save incoming message
  await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

  // Get lead info for context
  const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
  let leadContext = '';
  if (lead) {
    let prods = [];
    try { prods = JSON.parse(lead.products_interested || '[]'); } catch(e) {}

    // Get store info if available
    let storeInfo = null;
    if (lead.store_id) {
      storeInfo = await queryOne('SELECT name, city, state, address, phone, whatsapp FROM stores WHERE id = ?', [lead.store_id]);
    }
    if (!storeInfo && lead.store_name) {
      const slug = lead.store_name.toLowerCase().replace(/\s+/g, '-');
      storeInfo = await queryOne('SELECT name, city, state, address, phone, whatsapp FROM stores WHERE slug = ? OR name ILIKE ? OR name ILIKE ?',
        [slug, lead.store_name, `%${lead.store_name}%`]);
    }

    // Get FULL product details for interested products (not just prices)
    let productPrices = '';
    let productDetails = '';
    if (prods.length > 0) {
      const prodData = (await Promise.all(prods.map(pName => queryOne('SELECT name, slug, sku, base_price, format, finish, type, pei, usage, description, category FROM products WHERE name ILIKE ?', [`%${pName.toLowerCase()}%`])))).filter(Boolean);
      if (prodData.length > 0) {
        productPrices = prodData.map(p => `${p.name}: $${p.base_price || 'consultar'}/m² · ${p.format || ''}`).join(', ');
        productDetails = prodData.map(p => {
          let detail = `PRODUCTO: ${p.name} (SKU: ${p.sku || p.slug})`;
          detail += `\n  Precio: $${p.base_price || 'consultar'}/m²`;
          detail += `\n  Formato: ${p.format || 'Gran formato'}`;
          detail += `\n  Acabado: ${p.finish || 'Premium'}`;
          detail += `\n  Tipo: ${p.type || 'Porcelánico'}`;
          if (p.pei) detail += `\n  PEI: ${p.pei} (${p.pei >= 4 ? 'alto tráfico/comercial' : p.pei >= 3 ? 'toda la casa' : 'tráfico ligero'})`;
          if (p.usage) detail += `\n  Uso recomendado: ${p.usage}`;
          if (p.description) detail += `\n  Descripción: ${p.description}`;
          detail += `\n  Link: cesantoni-experience-za74.onrender.com/p/${p.sku || p.slug}`;
          return detail;
        }).join('\n');
      }
    }

    const storeCity = storeInfo ? `${storeInfo.city || ''}, ${storeInfo.state || ''}`.trim().replace(/^,|,$/g, '') : '';
    const storePhone = storeInfo ? (storeInfo.whatsapp || storeInfo.phone || '') : '';

    leadContext = `\nCONTEXTO DEL LEAD (YA TIENES ESTA INFO, ÚSALA):
- Fuente: ${lead.source === 'landing' ? 'Escaneó QR en tienda' : lead.source === 'terra_qr' ? 'Usó Terra en tienda' : 'WhatsApp directo'}
- Tienda: ${lead.store_name || 'No especificada'}${storeCity ? ' (' + storeCity + ')' : ''}${storePhone ? ' · Tel: ' + storePhone : ''}
- Pisos que le interesan: ${prods.length > 0 ? prods.join(', ') : 'No especificados'}
${productPrices ? '- Precios: ' + productPrices : ''}
- Notas: ${lead.notes || ''}
${productDetails ? '\nDETALLES COMPLETOS DEL PRODUCTO QUE LE INTERESA:\n' + productDetails : ''}

IMPORTANTE PARA ESTE LEAD:
${lead.source === 'landing' || lead.source === 'terra_qr' ? '- Este cliente ESTÁ EN LA TIENDA AHORA (escaneó QR ahí). NO le digas "pasa a la tienda" ni "te contactaremos" — YA ESTÁ AHÍ.' : '- Lead orgánico, puede no estar en tienda.'}
${storeCity ? '- YA SABES su ciudad (' + storeCity + ') — NUNCA preguntes ciudad.' : ''}
${lead.store_name ? '- YA SABES su tienda (' + lead.store_name + ') — NUNCA preguntes tienda.' : ''}
${productPrices ? '- YA TIENES precios — dáselos DIRECTO cuando pregunte.' : ''}
- Solo necesitas los m² para cotizar
- Si dijo m², calcula: precio × m² × 1.1 (merma) y da el total directo
- Si está en tienda, dile "pídele a un asesor ahí que te ayude a cerrar"
- NUNCA digas "te contactaremos" ni "la tienda se pondrá en contacto"`;
  }

  // Get product catalog (compact)
  const products = await query('SELECT id, name, slug, category, format, finish, pei, usage, base_price FROM products WHERE active = 1 ORDER BY name');
  const catalogText = products.map(p =>
    `${p.name}|${p.slug}|${p.category||'PREMIUM'}|${p.format||''}|PEI:${p.pei||''}|${p.finish||''}|${p.usage||''}${p.base_price ? '|$'+p.base_price : ''}`
  ).join('\n');

  const systemPrompt = `Eres Terra, la asesora de pisos de Cesantoni por WhatsApp. Eres amable, experta y directa. Tu meta es convertir cada conversación en una cotización o visita a tienda.

REGLAS ESTRICTAS:
- MÁXIMO 2-3 oraciones por mensaje. Es WhatsApp, NO un email. Sé BREVE.
- NUNCA hagas listas largas ni cuestionarios. Una pregunta a la vez.
- Responde en español mexicano, cálido y directo
- Si preguntan por un producto, usa los DATOS REALES del producto (formato, acabado, PEI, uso, descripción). NO des respuestas genéricas como "es porcelánico y resistente" — usa las especificaciones técnicas reales.
- Si no saben qué quieren, haz UNA sola pregunta: "¿Para qué espacio lo necesitas?"
- Si preguntan precio, usa el precio real del catálogo/contexto. Ofrece cotización.
- Para cotización solo necesitas: m² aproximados y ciudad. NO pidas nombre, teléfono, ni tipo de piso (ya lo sabes del contexto)
- NUNCA inventes productos que no están en el catálogo
- LINKS: Solo incluye el link la PRIMERA vez que mencionas un producto. NO repitas el mismo link en cada mensaje.
- Máximo 1 emoji por mensaje
- PROHIBIDO: listas con viñetas, formularios, preguntas múltiples, mensajes largos, respuestas genéricas sin datos del producto

CUANDO PREGUNTEN SOBRE UN PRODUCTO ESPECÍFICO:
- Usa los datos reales de "DETALLES COMPLETOS DEL PRODUCTO" en el contexto
- Ejemplo: si preguntan "¿es fácil de limpiar?" y es acabado NATURAL, di "Sí, el acabado natural del NEKK no acumula suciedad y se limpia con agua y jabón neutro, sin necesidad de ceras."
- Ejemplo: si preguntan "¿es resistente?" y tiene PEI 4, di "Sí, tiene PEI 4 (apto para tráfico comercial), aguanta alto tráfico sin rayarse."
- NO digas solo "es porcelánico" — eso es genérico. Usa el dato específico del producto.

FLUJO DE CONVERSIÓN (una pregunta a la vez):
1. Cliente muestra interés → "¡Excelente! ¿Cuántos m² necesitas?"
2. Da m² y ya tienes precio → Calcula directo: "X m² × $precio + 10% merma = $total aprox. Pídele a un asesor ahí que te ayude a cerrar!"
3. Si NO sabes ciudad (lead orgánico) → "¿En qué ciudad estás?"
4. Da ciudad → "Te cotizo: X m² de Y = $Z aprox. Te paso la tienda más cercana."
${leadContext}
CESANTONI: Empresa mexicana premium de porcelanato. ${products.length} productos. 407 tiendas en México. Tecnología HD, gran formato, garantía.
TÉCNICO: PEI 3=toda la casa, PEI 4=comercios, PEI 5=industrial. Mate=no resbala, ideal baños/cocina. Pulido=brillo espejo, para sala/comedor. Lappato=semi-brillo elegante. Natural=fácil limpieza. Porcelánico <0.5% absorción=exterior/baño/piscina.

Cliente: ${customerName || from}
${history.length > 0 ? 'HISTORIAL:\n' + history.map(h => `${h.role === 'user' ? 'Cliente' : 'Terra'}: ${h.message}`).join('\n') : ''}

CATÁLOGO (${products.length} productos):
${catalogText}

Responde SOLO el texto del mensaje, nada más. No uses JSON ni markdown.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Entendido, soy Terra por WhatsApp.' }] },
            { role: 'user', parts: [{ text }] }
          ],
          generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
        })
      }
    );

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Disculpa, tuve un problema. ¿Puedes repetir tu mensaje?';

    // Auto-update lead status based on conversation progress
    if (lead && lead.status === 'new') {
      const allMsgs = history.map(h => h.message).join(' ') + ' ' + text;
      const hasCotizacion = /cotiza|metros|m2|m²|cuant.*cuest|precio/i.test(allMsgs);
      if (hasCotizacion) {
        await run('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['contacted', lead.id]);
        console.log(`📊 Lead ${lead.id} auto-updated to 'contacted'`);
      }
    }

    return reply;
  } catch (err) {
    console.error('WA Gemini error:', err.message);
    return 'Disculpa, tuve un problema técnico. Intenta de nuevo en un momento. 🙏';
  }
}

// Webhook verification (Meta sends GET to verify)
app.get('/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  console.log('❌ Webhook verification failed');
  res.sendStatus(403);
});

// Incoming messages from WhatsApp
app.post('/webhook', async (req, res) => {
  // Always respond 200 immediately (Meta requires fast response)
  res.sendStatus(200);

  // Forward to Make.com (existing CRM) in background
  if (WA_FORWARD_URL) {
    fetch(WA_FORWARD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    }).catch(e => console.log('Forward to Make.com error:', e.message));
  }

  try {
    const entry = req.body?.entry?.[0];
    if (entry?.id) global.lastWabaId = entry.id;
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Process status updates (delivered, read, failed)
    if (value?.statuses) {
      for (const status of value.statuses) {
        const { id: msgId, status: msgStatus, recipient_id, errors } = status;
        if (msgStatus === 'failed' && errors?.length) {
          console.error(`❌ WA message FAILED to ${recipient_id}: ${errors[0]?.title} — ${errors[0]?.message}`);
          // Log failed delivery
          try {
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
              [recipient_id, 'system', `[FAILED] ${errors[0]?.title}: ${errors[0]?.message}`]);
          } catch(e) {}
        } else if (msgStatus === 'delivered') {
          console.log(`✅ WA delivered to ${recipient_id}`);
        } else if (msgStatus === 'read') {
          console.log(`👀 WA read by ${recipient_id}`);
        }
      }
    }

    if (!value?.messages) return;

    const message = value.messages[0];
    const from = message.from; // phone number
    const contactName = value.contacts?.[0]?.profile?.name || '';

    console.log(`📱 WA from ${contactName} (${from}): ${message.type}`);

    // Mark as read
    markAsRead(message.id);

    // Handle text messages
    if (message.type === 'text') {
      const text = message.text.body;
      console.log(`   💬 "${text}"`);

      // Detect Terra in-store referral: "Hola Terra! Soy X desde Y. Me gustaron: A, B, C. Mandame mi resumen!"
      const terraMatch = text.match(/Hola Terra.*Soy\s+(.+?)\s+desde\s+(.+?)\.\s*Me gustaron:\s*(.+?)\.\s*Mandame/i);
      if (terraMatch) {
        const tName = terraMatch[1].trim();
        const tStore = terraMatch[2].trim();
        const tProducts = terraMatch[3].split(',').map(s => s.trim()).filter(Boolean);

        console.log(`🏪 Terra lead: ${tName} from ${tStore}, products: ${tProducts.join(', ')}`);

        // Save as lead conversation
        await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

        // Resolve store
        const tStoreSlug = tStore.toLowerCase().replace(/\s+/g, '-');
        const tStoreObj = await queryOne('SELECT * FROM stores WHERE slug = ? OR name ILIKE ? OR name ILIKE ?',
          [tStoreSlug, tStore, `%${tStore}%`]);
        const tStoreName = tStoreObj ? tStoreObj.name : tStore;
        const tStoreId = tStoreObj ? tStoreObj.id : null;

        // Create or update lead in CRM
        const tExisting = await queryOne('SELECT id FROM leads WHERE phone = ?', [from]);
        if (tExisting) {
          await run(`UPDATE leads SET source = 'terra_qr', name = ?, store_name = ?, store_id = ?, products_interested = ?,
               notes = COALESCE(notes, '') || '\n' || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [tName, tStoreName, tStoreId, JSON.stringify(tProducts), `Visita en tienda via Terra. Pisos: ${tProducts.join(', ')}`, tExisting.id]);
        } else {
          await run(`INSERT INTO leads (phone, name, source, store_name, store_id, products_interested, status, notes)
               VALUES (?, ?, 'terra_qr', ?, ?, ?, 'new', ?)`,
            [from, tName, tStoreName, tStoreId, JSON.stringify(tProducts), `Visita en tienda via Terra. Pisos: ${tProducts.join(', ')}`]);
        }

        // Look up products from DB
        const allProds = await query('SELECT id, name, slug, category, format, finish, pei, usage, image_url FROM products WHERE active = 1');
        const matchedProducts = tProducts.map(pName => {
          return allProds.find(p => p.name.toLowerCase() === pName.toLowerCase()) ||
                 allProds.find(p => p.name.toLowerCase().includes(pName.toLowerCase())) ||
                 null;
        }).filter(Boolean);

        // Send greeting
        const baseUrl = 'https://cesantoni-experience-za74.onrender.com';
        let greeting = `Hola ${tName}! 👋 Soy Terra de Cesantoni. Vi que te gustaron ${matchedProducts.length} piso${matchedProducts.length > 1 ? 's' : ''} en *${tStore}*. Aqui va tu resumen:\n`;
        await sendWhatsApp(from, greeting);

        // Send each product as image + full details
        for (const p of matchedProducts) {
          // Image first
          if (p.image_url) {
            await sendWhatsAppImage(from, p.image_url, `*${p.name}*\n${p.category || 'Piso Premium'} · Cesantoni`);
            await new Promise(r => setTimeout(r, 800));
          }

          // Technical sheet
          const pei = parseInt(p.pei) || 0;
          const peiTip = pei >= 4 ? 'Alto tráfico' : pei >= 3 ? 'Toda la casa' : pei >= 2 ? 'Tráfico ligero' : '';
          let sheet = `📋 *${p.name} — Ficha Técnica*\n\n`;
          sheet += `📐 *Formato:* ${p.format || 'Consultar'}\n`;
          sheet += `✨ *Acabado:* ${p.finish || 'Premium'}\n`;
          if (p.pei) sheet += `💪 *PEI:* ${p.pei} — ${peiTip}\n`;
          if (p.usage) sheet += `🏠 *Uso:* ${p.usage}\n`;
          sheet += `\n🔗 ${baseUrl}/p/${p.slug || p.id}`;

          await sendWhatsApp(from, sheet);
          await new Promise(r => setTimeout(r, 800));
        }

        // Send closing message
        const closing = matchedProducts.length >= 2
          ? `Esos son tus ${matchedProducts.length} pisos, ${tName}! Si necesitas cotizacion, ayuda para elegir, o quieres ver mas opciones, escribeme aqui. Estoy para ti! 😊`
          : `Ese es tu piso, ${tName}! Si necesitas cotizacion o quieres ver mas opciones, escribeme aqui. Estoy para ti! 😊`;
        await sendWhatsApp(from, closing);

        // Save bot reply
        await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
          [from, 'assistant', `Resumen enviado: ${matchedProducts.map(p => p.name).join(', ')}`]);

        return; // Don't process as normal message
      }

      // Detect Landing page referral: "Hola! Vi el piso X en Y y quiero mas info. REF:SKU"
      const landingMatch = text.match(/Vi el piso\s+(.+?)\s+en\s+(.+?)\s+y quiero m[aá]s info\.?\s*REF:(\S+)/i);
      if (landingMatch) {
        const lProductName = landingMatch[1].trim();
        const lStore = landingMatch[2].trim();
        const lSku = landingMatch[3].trim();

        console.log(`🌐 Landing lead: product=${lProductName}, store=${lStore}, sku=${lSku}`);

        // Save conversation
        await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

        // Look up product by SKU or name
        let lProduct = await queryOne('SELECT * FROM products WHERE sku ILIKE ? OR slug ILIKE ?', [lSku, lSku]);
        if (!lProduct) {
          lProduct = await queryOne('SELECT * FROM products WHERE name ILIKE ?', [`%${lProductName.toLowerCase()}%`]);
        }

        // Look up store by name (normalize: "cesantoni galerias" → match slug "cesantoni-galerias")
        const lStoreSlug = lStore.toLowerCase().replace(/\s+/g, '-');
        const lStoreObj = await queryOne('SELECT * FROM stores WHERE slug = ? OR name ILIKE ? OR name ILIKE ?',
          [lStoreSlug, lStore, `%${lStore}%`]);
        const lStoreName = lStoreObj ? lStoreObj.name : lStore;
        const lStoreId = lStoreObj ? lStoreObj.id : null;

        // Create lead with proper store info
        const existingLead = await queryOne('SELECT id FROM leads WHERE phone = ?', [from]);
        if (existingLead) {
          await run(`UPDATE leads SET source = 'landing', store_name = ?, store_id = ?, products_interested = ?,
               name = CASE WHEN name IS NULL OR name = phone THEN ? ELSE name END,
               notes = COALESCE(notes, '') || '\n' || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [lStoreName, lStoreId, JSON.stringify([lProductName]), contactName || from, `Landing page: ${lProductName} (${lSku}) desde ${lStoreName}`, existingLead.id]);
        } else {
          await run(`INSERT INTO leads (phone, name, source, store_name, store_id, products_interested, status, notes)
               VALUES (?, ?, 'landing', ?, ?, ?, 'new', ?)`,
            [from, contactName || from, lStoreName, lStoreId, JSON.stringify([lProductName]),
             `Desde landing page. Piso: ${lProductName} (${lSku}). Tienda: ${lStoreName}`]);
        }

        const baseUrl = 'https://cesantoni-experience-za74.onrender.com';

        if (lProduct) {
          // Build compact caption with all key info
          const pei = parseInt(lProduct.pei) || 0;
          const peiTip = pei >= 4 ? 'Alto tráfico' : pei >= 3 ? 'Toda la casa' : pei >= 2 ? 'Tráfico ligero' : '';
          const finishUpper = (lProduct.finish || '').toUpperCase();
          const finishTip = finishUpper.includes('MATE') ? 'no resbala' :
                            finishUpper.includes('PULIDO') ? 'brillo espejo' :
                            finishUpper.includes('LAPPATO') ? 'semi-brillo' :
                            finishUpper.includes('TEXTUR') || finishUpper.includes('ANTIDERRAPANTE') ? 'antiderrapante' : '';

          let caption = `*${lProduct.name}*${lProduct.base_price ? ' · $' + lProduct.base_price + '/m²' : ''}\n\n`;
          caption += `📐 ${lProduct.format || 'Gran formato'}\n`;
          caption += `✨ ${lProduct.finish || 'Premium'}${finishTip ? ' (' + finishTip + ')' : ''}\n`;
          if (lProduct.pei) caption += `💪 PEI ${lProduct.pei} — ${peiTip}\n`;
          if (lProduct.usage) caption += `🏠 ${lProduct.usage}\n`;
          if (lStoreObj?.promo_text || lStoreObj?.promo_discount) {
            caption += `\n🏷️ *${lStoreObj.promo_text || 'Promoción'}*${lStoreObj.promo_discount ? ' — ' + lStoreObj.promo_discount : ''}\n`;
          }
          caption += `\n🔗 ${baseUrl}/p/${lProduct.sku || lProduct.slug || lProduct.id}`;

          if (lProduct.image_url) {
            await sendWhatsAppImage(from, lProduct.image_url, caption);
          } else {
            await sendWhatsApp(from, caption);
          }

          await new Promise(r => setTimeout(r, 800));

          // Follow-up with interactive buttons
          const storeRef = lStoreObj ? `\nUn asesor en *${lStoreObj.name}* te atiende ahora.` : '';
          await sendWhatsAppButtons(from,
            `Hola! Soy Terra 👋 ¿En qué te ayudo?${storeRef}`,
            [
              { id: 'calcular_m2', title: '📐 Calcular m²' },
              { id: 'ver_similares', title: '🔍 Ver similares' },
              { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
            ]
          );
        } else {
          await sendWhatsApp(from, `Hola! 👋 Soy Terra de Cesantoni. Vi que te interesa el piso *${lProductName}*.\n\nDejame buscarte la info y te la mando. ¿En qué más te puedo ayudar? 😊`);
        }

        return;
      }

      // --- Appointment scheduling: detect if user is answering the appointment prompt ---
      const waitingAppt = await queryOne(
        "SELECT id FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message = '[WAITING_APPOINTMENT]' ORDER BY created_at DESC LIMIT 1", [from]);
      if (waitingAppt) {
        await run('DELETE FROM wa_conversations WHERE id = ?', [waitingAppt.id]);
        const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
        const store = lead?.store_id ? await queryOne('SELECT * FROM stores WHERE id = ?', [lead.store_id]) : null;
        const leadName = lead?.name || contactName || 'Cliente';
        const storeName = store?.name || 'Tienda Cesantoni';
        const appointmentText = text.trim();

        await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

        // Notify store advisor about the appointment
        if (store?.whatsapp) {
          await sendWhatsAppTemplate(store.whatsapp, 'lead_nuevo', [
            leadName, from, storeName, `📅 CITA: ${appointmentText}`
          ]);
          await new Promise(r => setTimeout(r, 1000));
          await sendWhatsApp(store.whatsapp, `📅 *Cita agendada*\n\n👤 ${leadName}\n📱 wa.me/${from}\n🕐 ${appointmentText}\n🏪 ${storeName}\n\nPor favor confirma la cita con el cliente.`);
        }

        await sendWhatsApp(from, `✅ *¡Cita agendada!*\n\n🏪 ${storeName}\n🕐 ${appointmentText}\n\nUn asesor confirmará tu visita. ¡Te esperamos! 😊`);
        if (lead) await run("UPDATE leads SET status = 'appointment' WHERE id = ?", [lead.id]);
        return;
      }

      // --- M² Calculator: detect if user is answering the "¿Cuántos m²?" prompt ---
      const m2Number = text.match(/^[\s]*(\d+(?:[.,]\d+)?)\s*(m2|m²|metros?)?\s*$/i);
      if (m2Number) {
        const lastBotMsg = await queryOne(
          "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1", [from]);
        if (lastBotMsg && lastBotMsg.message && lastBotMsg.message.includes('Cuántos m²')) {
          const m2 = parseFloat(m2Number[1].replace(',', '.'));
          const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
          const prods = lead?.products_interested ? JSON.parse(lead.products_interested) : [];
          const prodName = prods[0] || '';
          const product = prodName ? await queryOne('SELECT * FROM products WHERE name ILIKE ?', [`%${prodName}%`]) : null;

          if (product && product.sqm_per_box && product.base_price) {
            const m2ConMerma = m2 * 1.10; // +10% merma recomendada
            const boxes = Math.ceil(m2ConMerma / product.sqm_per_box);
            const totalM2 = (boxes * product.sqm_per_box).toFixed(2);
            const totalPrice = Math.round(boxes * product.sqm_per_box * product.base_price);
            const piecesTotal = boxes * (product.pieces_per_box || 0);

            let calc = `📐 *Cotización ${product.name}*\n\n`;
            calc += `Área: *${m2} m²* + 10% merma = *${m2ConMerma.toFixed(1)} m²*\n`;
            calc += `Cajas: *${boxes}* (${totalM2} m² reales)\n`;
            if (piecesTotal) calc += `Piezas: *${piecesTotal}*\n`;
            calc += `Precio: $${product.base_price}/m²\n`;
            calc += `\n💰 *Total estimado: $${totalPrice.toLocaleString('es-MX')}*\n`;
            calc += `\n_Incluye 10% de merma recomendada por cortes_`;

            await sendWhatsApp(from, calc);
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

            // Save quote item to conversation for multi-product cart
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
              [from, 'assistant', `[QUOTE_ITEM] ${product.name}|${m2}|${m2ConMerma.toFixed(1)}|${boxes}|${totalM2}|${totalPrice}`]);

            // Follow-up buttons
            await new Promise(r => setTimeout(r, 500));
            await sendWhatsAppButtons(from,
              '¿Qué quieres hacer?',
              [
                { id: 'agregar_otro', title: '➕ Agregar otro piso' },
                { id: 'enviar_cotizacion', title: '📄 Ver cotización' },
                { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
              ]
            );
            return;
          } else if (product) {
            // Product found but no sqm_per_box data
            const totalPrice = product.base_price ? Math.round(m2 * product.base_price) : null;
            let calc = `📐 *Cotización ${product.name}*\n\n`;
            calc += `Área: *${m2} m²*\n`;
            calc += `Precio: $${product.base_price || '?'}/m²\n`;
            if (totalPrice) calc += `\n💰 *Total estimado: $${totalPrice.toLocaleString('es-MX')}*\n`;
            calc += `\nPara el número exacto de cajas, consulta con un asesor en tienda.`;

            await sendWhatsApp(from, calc);
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

            await new Promise(r => setTimeout(r, 500));
            await sendWhatsAppButtons(from,
              '¿Qué quieres hacer?',
              [
                { id: 'agregar_otro', title: '➕ Agregar otro piso' },
                { id: 'hablar_asesor', title: '👤 Hablar c/asesor' },
                { id: 'ver_similares', title: '🔍 Ver similares' }
              ]
            );
            return;
          }
        }
      }

      // --- Dimension calculator: detect "3x4", "3 x 4", "3m x 4m" etc. ---
      const dimMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m(?:ts?|etros?)?)?\s*[x×X]\s*(\d+(?:[.,]\d+)?)\s*(?:m(?:ts?|etros?)?)?/i);
      if (dimMatch) {
        const lastBotMsg = await queryOne(
          "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1", [from]);
        if (lastBotMsg && lastBotMsg.message && lastBotMsg.message.includes('Cuántos m²')) {
          const largo = parseFloat(dimMatch[1].replace(',', '.'));
          const ancho = parseFloat(dimMatch[2].replace(',', '.'));
          const m2 = largo * ancho;

          const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
          const prods = lead?.products_interested ? JSON.parse(lead.products_interested) : [];
          const prodName = prods[0] || '';
          const product = prodName ? await queryOne('SELECT * FROM products WHERE name ILIKE ?', [`%${prodName}%`]) : null;

          if (product && product.sqm_per_box && product.base_price) {
            const m2ConMerma = m2 * 1.10; // +10% merma recomendada
            const boxes = Math.ceil(m2ConMerma / product.sqm_per_box);
            const totalM2 = (boxes * product.sqm_per_box).toFixed(2);
            const totalPrice = Math.round(boxes * product.sqm_per_box * product.base_price);
            const piecesTotal = boxes * (product.pieces_per_box || 0);

            let calc = `📐 *Cotización ${product.name}*\n\n`;
            calc += `Medidas: ${largo} × ${ancho} = *${m2.toFixed(1)} m²* + 10% merma = *${m2ConMerma.toFixed(1)} m²*\n`;
            calc += `Cajas: *${boxes}* (${totalM2} m² reales)\n`;
            if (piecesTotal) calc += `Piezas: *${piecesTotal}*\n`;
            calc += `Precio: $${product.base_price}/m²\n`;
            calc += `\n💰 *Total estimado: $${totalPrice.toLocaleString('es-MX')}*\n`;
            calc += `\n_Incluye 10% de merma recomendada por cortes_`;

            await sendWhatsApp(from, calc);
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

            // Save quote item for multi-product cart
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
              [from, 'assistant', `[QUOTE_ITEM] ${product.name}|${m2.toFixed(1)}|${m2ConMerma.toFixed(1)}|${boxes}|${totalM2}|${totalPrice}`]);

            await new Promise(r => setTimeout(r, 500));
            await sendWhatsAppButtons(from,
              '¿Qué quieres hacer?',
              [
                { id: 'agregar_otro', title: '➕ Agregar otro piso' },
                { id: 'enviar_cotizacion', title: '📄 Ver cotización' },
                { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
              ]
            );
            return;
          } else {
            const totalPrice = product?.base_price ? Math.round(m2 * product.base_price) : null;
            let calc = `📐 *Cotización ${prodName || 'Piso'}*\n\n`;
            calc += `Medidas: ${largo} × ${ancho} = *${m2.toFixed(1)} m²*\n`;
            if (product?.base_price) calc += `Precio: $${product.base_price}/m²\n`;
            if (totalPrice) calc += `\n💰 *Total estimado: $${totalPrice.toLocaleString('es-MX')}*\n`;

            await sendWhatsApp(from, calc);
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);
            return;
          }
        }
      }

      // --- Catalog by category: detect "pisos de madera", "pisos para baño", etc. ---
      const catMatch = text.match(/(?:pisos?|porcelanatos?|cerámicas?|losetas?)\s+(?:de|tipo|estilo|para|como|look)\s+(.+)/i)
        || text.match(/(?:qué|que|tienen|muestrame|muéstrame|ver)\s+(?:pisos?|porcelanatos?)\s+(?:de|tipo|para)\s+(.+)/i)
        || text.match(/^(madera|mármol|marmol|piedra|cemento|concreto|mosaico|rústico|rustico|moderno|mate|brillante|exterior|baño|cocina|sala|terraza)s?$/i);
      if (catMatch) {
        const catSearch = (catMatch[1] || catMatch[0]).trim().toLowerCase().replace(/[?.!]/g, '');
        await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

        // Special queries for categories that need custom logic
        let catProducts = [];
        const isWood = /madera|wood/i.test(catSearch);
        const isMarble = /m[aá]rmol|marble/i.test(catSearch);
        const isStone = /piedra|stone/i.test(catSearch);

        if (isWood) {
          // Wood-look = format 20x120, 20x160, 26x160 or "wood" in name
          catProducts = await query(
            `SELECT * FROM products WHERE active = 1 AND (
              name ILIKE '%wood%' OR format ILIKE '%20 x 120%' OR format ILIKE '%20 x 160%' OR format ILIKE '%26 x 160%'
              OR description ILIKE '%madera%'
            ) ORDER BY RANDOM() LIMIT 10`);
        } else if (isMarble) {
          // Marble-look = marble keywords in description, or known marble names
          // Exclude wood-look formats and names
          catProducts = await query(
            `SELECT * FROM products WHERE active = 1 AND (
              description ILIKE '%m_rmol%' OR description ILIKE '%marble%' OR description ILIKE '%calacatta%'
              OR description ILIKE '%carrara%' OR description ILIKE '%venato%'
              OR name ILIKE '%calacatta%' OR name ILIKE '%bianco%' OR name ILIKE '%quarzo%'
              OR ((format ILIKE '%60x120%' OR format ILIKE '%60 x 120%' OR format ILIKE '%80x160%' OR format ILIKE '%80 x 160%')
                  AND (finish ILIKE '%BRILLANTE%' OR finish ILIKE '%PULIDO%' OR finish ILIKE '%SATINADO%'))
            )
            AND name NOT ILIKE '%wood%' AND name NOT ILIKE '%mutina%' AND name NOT ILIKE '%maple%'
            AND format NOT ILIKE '%20 x 120%' AND format NOT ILIKE '%20 x 160%' AND format NOT ILIKE '%26 x 160%'
            ORDER BY RANDOM() LIMIT 10`);
        } else if (isStone) {
          catProducts = await query(
            `SELECT * FROM products WHERE active = 1 AND (
              description ILIKE '%piedra%' OR description ILIKE '%stone%' OR description ILIKE '%roca%'
              OR name ILIKE '%piatra%' OR name ILIKE '%coral%'
            ) ORDER BY RANDOM() LIMIT 10`);
        } else {
          // Generic: search by finish, usage, name, description
          const catMap = {
            'cemento': { col: 'description', val: '%cemento%', alt: '%concrete%' },
            'concreto': { col: 'description', val: '%cemento%', alt: '%concreto%' },
            'mosaico': { col: 'description', val: '%mosaico%', alt: '%mosaic%' },
            'mate': { col: 'finish', val: '%MATE%', alt: '%matte%' },
            'brillante': { col: 'finish', val: '%BRILLANTE%', alt: '%PULIDO%' },
            'rústico': { col: 'description', val: '%r_stic%', alt: '%rustic%' },
            'rustico': { col: 'description', val: '%r_stic%', alt: '%rustic%' },
            'moderno': { col: 'description', val: '%moderno%', alt: '%modern%' },
            'exterior': { col: 'usage', val: '%Exterior%', alt: '%outdoor%' },
            'baño': { col: 'usage', val: '%Baño%', alt: '%bath%' },
            'cocina': { col: 'usage', val: '%Cocina%', alt: '%kitchen%' },
            'sala': { col: 'usage', val: '%Interior%', alt: '%sala%' },
            'terraza': { col: 'usage', val: '%Exterior%', alt: '%terraza%' },
          };
          const mapped = catMap[catSearch];
          if (mapped) {
            catProducts = await query(
              `SELECT * FROM products WHERE active = 1 AND (${mapped.col} ILIKE ? OR ${mapped.col} ILIKE ? OR name ILIKE ?) ORDER BY RANDOM() LIMIT 5`,
              [mapped.val, mapped.alt, `%${catSearch}%`]);
          }
        }
        if (catProducts.length === 0) {
          catProducts = await query(
            'SELECT * FROM products WHERE active = 1 AND (name ILIKE ? OR finish ILIKE ? OR usage ILIKE ? OR description ILIKE ?) ORDER BY RANDOM() LIMIT 5',
            [`%${catSearch}%`, `%${catSearch}%`, `%${catSearch}%`, `%${catSearch}%`]);
        }

        if (catProducts.length > 0) {
          const baseUrl = 'https://cesantoni-experience-za74.onrender.com';
          // Send as interactive list + first product image
          const listRows = catProducts.map(s => ({
            id: `cat_${s.sku || s.slug || s.id}`,
            title: s.name,
            description: `$${s.base_price || '?'}/m² · ${s.format || ''} · ${s.finish || ''}`
          }));
          await sendWhatsAppList(from,
            `🏠 *Pisos estilo ${catSearch}* — ${catProducts.length} opciones.\nSelecciona los que te interesen:`,
            'Ver pisos',
            [{ title: `Estilo ${catSearch}`, rows: listRows }]
          );
          // Save last catalog search for "ver más" button
          await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'system' AND message LIKE '[LAST_CATALOG]%'", [from]);
          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
            [from, 'system', `[LAST_CATALOG] ${catSearch}`]);
          // Also send first product image as preview
          if (catProducts[0]?.image_url) {
            await new Promise(r => setTimeout(r, 500));
            await sendWhatsAppImage(from, catProducts[0].image_url, `${catProducts[0].name} — $${catProducts[0].base_price || '?'}/m²`);
          }
          return;
        }
        // Fall through if no products found for this category
      }

      // --- Store locator: detect "tienda en [city]", "sucursal", "dónde comprar" ---
      const storeQuery = text.match(/(?:tienda|sucursal|donde|dónde|comprar|distribuidor).*(?:en|cerca|por)\s+(.+)/i)
        || text.match(/(?:tienda|sucursal)s?\s+(?:en|de|cerca)\s+(.+)/i);
      if (storeQuery) {
        const citySearch = storeQuery[1].trim().replace(/[?.!]/g, '');
        const stores = await query(
          `SELECT s.name, s.city, s.state, s.address, s.whatsapp, s.phone, d.name as distributor
           FROM stores s LEFT JOIN distributors d ON s.distributor_id = d.id
           WHERE s.active = 1 AND (s.city ILIKE ? OR s.state ILIKE ? OR s.name ILIKE ?)
           ORDER BY s.name LIMIT 5`,
          [`%${citySearch}%`, `%${citySearch}%`, `%${citySearch}%`]
        );

        if (stores.length > 0) {
          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);
          let msg = `🏪 Tiendas Cesantoni en *${citySearch}*:\n\n`;
          for (const s of stores) {
            msg += `📍 *${s.name}*\n`;
            if (s.address) msg += `   ${s.address}\n`;
            msg += `   ${s.city}, ${s.state}\n`;
            if (s.whatsapp) msg += `   📱 wa.me/${s.whatsapp.replace(/\D/g, '')}\n`;
            else if (s.phone) msg += `   📞 ${s.phone}\n`;
            msg += `\n`;
          }
          msg += `¿Quieres que te ayude con algo más? 😊`;
          await sendWhatsApp(from, msg);
          return;
        }
        // If no stores found, fall through to AI which might handle it differently
      }

      // --- Product search: detect if user types a product name ---
      const cleanText = text.trim().toLowerCase();
      if (cleanText.length >= 3 && cleanText.length <= 30 && !/\s{2,}/.test(cleanText)) {
        const matchedProduct = await queryOne(
          'SELECT * FROM products WHERE active = 1 AND (name ILIKE ? OR sku ILIKE ? OR slug ILIKE ?)',
          [`%${cleanText}%`, `%${cleanText}%`, `%${cleanText}%`]
        );
        if (matchedProduct && cleanText !== 'hola' && cleanText !== 'si' && cleanText !== 'no' && cleanText !== 'ok' && cleanText !== 'gracias') {
          const baseUrl = 'https://cesantoni-experience-za74.onrender.com';
          const p = matchedProduct;
          const pei = parseInt(p.pei) || 0;
          const peiTip = pei >= 4 ? 'Alto tráfico' : pei >= 3 ? 'Toda la casa' : pei >= 2 ? 'Tráfico ligero' : '';

          // Check store inventory if lead has a store
          const leadForStock = await queryOne('SELECT store_id FROM leads WHERE phone = ?', [from]);
          let stockInfo = '';
          if (leadForStock?.store_id) {
            const inv = await queryOne('SELECT in_stock FROM store_inventory WHERE store_id = ? AND product_id = ?', [leadForStock.store_id, p.id]);
            if (inv) stockInfo = inv.in_stock ? '\n✅ Disponible en tu tienda' : '\n⚠️ No disponible en tu tienda — consulta opciones';
          }

          let caption = `*${p.name}*${p.base_price ? ' · $' + p.base_price + '/m²' : ''}\n\n`;
          caption += `📐 ${p.format || 'Gran formato'}\n`;
          caption += `✨ ${p.finish || 'Premium'}\n`;
          if (p.pei) caption += `💪 PEI ${p.pei} — ${peiTip}\n`;
          if (p.usage) caption += `🏠 ${p.usage}\n`;
          if (stockInfo) caption += stockInfo + '\n';
          caption += `\n🔗 ${baseUrl}/p/${p.sku || p.slug || p.id}`;

          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

          if (p.image_url) {
            await sendWhatsAppImage(from, p.image_url, caption);
          } else {
            await sendWhatsApp(from, caption);
          }

          // Update lead with this product
          const existLead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
          if (existLead) {
            const prods = existLead.products_interested ? JSON.parse(existLead.products_interested) : [];
            if (!prods.includes(p.name)) {
              prods.push(p.name);
              await run('UPDATE leads SET products_interested = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [JSON.stringify(prods), existLead.id]);
            }
          }

          // Track viewed product for comparator + score
          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
            [from, 'assistant', `[VIEWED_PRODUCT] ${p.name}`]);
          await addLeadScore(from, 10, 'product_view');

          await new Promise(r => setTimeout(r, 800));
          await sendWhatsAppButtons(from,
            `¿Qué quieres saber de *${p.name}*?`,
            [
              { id: 'calcular_m2', title: '📐 Calcular m²' },
              { id: 'comparar', title: '⚖️ Comparar' },
              { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
            ]
          );
          return;
        }
      }

      // Create lead if first message from this phone (WhatsApp bot lead)
      const existingLead = await queryOne('SELECT id FROM leads WHERE phone = ?', [from]);
      if (!existingLead) {
        await run(`INSERT INTO leads (phone, name, source, status, notes) VALUES (?, ?, 'whatsapp_bot', 'new', ?)`,
          [from, contactName || from, `Contacto directo por WhatsApp. Primer mensaje: ${text.substring(0, 100)}`]);
      }

      const reply = await processWhatsAppMessage(from, text, contactName);
      await sendWhatsApp(from, reply);

      // If reply mentions a product link, also send the product image
      const slugMatch = reply.match(/\/p\/([A-Za-z0-9_-]+)/i);
      if (slugMatch) {
        const pSlug = slugMatch[1];
        const product = await queryOne('SELECT name, image_url, slug FROM products WHERE slug = ? OR sku = ? OR slug ILIKE ? OR sku ILIKE ?', [pSlug, pSlug, pSlug, pSlug]);
        if (product?.image_url) {
          await sendWhatsAppImage(from, product.image_url, `${product.name} - Cesantoni`);
        }
      }
    } else if (message.type === 'interactive') {
      // Handle button replies AND list replies
      const btnId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';
      const btnTitle = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
      const isListReply = !!message.interactive?.list_reply;
      console.log(`   🔘 ${isListReply ? 'List' : 'Button'}: ${btnId} "${btnTitle}"`);

      await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', `[Botón] ${btnTitle}`]);

      // Get lead context
      const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
      const prods = lead?.products_interested ? JSON.parse(lead.products_interested) : [];
      const prodName = prods[0] || '';
      const product = prodName ? await queryOne('SELECT * FROM products WHERE name ILIKE ?', [`%${prodName.toLowerCase()}%`]) : null;

      if (btnId === 'calcular_m2') {
        await sendWhatsApp(from, `¡Perfecto! ¿Cuántos m² necesitas de *${prodName || 'piso'}*? Si no sabes exacto, dime las medidas del espacio y lo calculo. 📐`);
        await addLeadScore(from, 20, 'calcular_m2');
      } else if (btnId === 'ver_similares') {
        // Find similar products by format (same size = same look) then by finish
        const baseUrl = 'https://cesantoni-experience-za74.onrender.com';
        let similares = [];
        if (product) {
          similares = await query('SELECT id, name, base_price, format, sku, slug, image_url, finish, pei, usage FROM products WHERE active = 1 AND id != ? AND format = ? ORDER BY RANDOM() LIMIT 3',
            [product.id, product.format]);
          if (similares.length < 3) {
            const excludeIds = [product.id, ...similares.map(s => s.id)].join(',');
            const more = await query(`SELECT id, name, base_price, format, sku, slug, image_url, finish, pei, usage FROM products WHERE active = 1 AND id NOT IN (${excludeIds}) AND finish = ? ORDER BY RANDOM() LIMIT ?`,
              [product.finish, 3 - similares.length]);
            similares = [...similares, ...more];
          }
        }
        if (similares.length === 0) {
          similares = await query('SELECT id, name, base_price, format, sku, slug, image_url, finish, pei, usage FROM products WHERE active = 1 ORDER BY RANDOM() LIMIT 3');
        }
        if (similares.length > 0) {
          await sendWhatsApp(from, `Pisos similares a *${prodName}*:`);
          await new Promise(r => setTimeout(r, 500));

          for (const s of similares) {
            const link = `${baseUrl}/p/${s.sku || s.slug || s.name}`;
            const pei = parseInt(s.pei) || 0;
            const peiTip = pei >= 4 ? 'Alto tráfico' : pei >= 3 ? 'Toda la casa' : pei >= 2 ? 'Tráfico ligero' : '';
            let caption = `*${s.name}* · $${s.base_price || '?'}/m²\n`;
            caption += `📐 ${s.format || ''} · ✨ ${s.finish || ''}\n`;
            if (s.pei) caption += `💪 PEI ${s.pei} — ${peiTip}\n`;
            caption += `\n🔗 ${link}`;

            if (s.image_url) {
              await sendWhatsAppImage(from, s.image_url, caption);
            } else {
              await sendWhatsApp(from, caption);
            }
            await new Promise(r => setTimeout(r, 800));
          }

          await new Promise(r => setTimeout(r, 500));
          await sendWhatsApp(from, `¿Cuál te interesa? Escríbeme el nombre y te doy más info. 😊`);
        } else {
          await sendWhatsApp(from, `Deja busco opciones similares. ¿Qué estilo buscas? ¿Madera, mármol, piedra? 🤔`);
        }
      } else if (btnId === 'hablar_asesor') {
        await addLeadScore(from, 50, 'hablar_asesor');
        const store = lead?.store_id ? await queryOne('SELECT * FROM stores WHERE id = ?', [lead.store_id]) : null;

        // Notify the store advisor with lead info via template
        if (store?.whatsapp) {
          const leadName = lead?.name || contactName || 'Cliente';
          const leadPhone = from;
          const productsText = prods.length > 0 ? prods.join(', ') : 'Pisos Cesantoni';
          const storeName = store.name || 'Tienda';

          // Get last messages from the lead for context
          const recentMsgs = await query(
            "SELECT role, message FROM wa_conversations WHERE phone = ? ORDER BY created_at DESC LIMIT 5", [from]);
          const conversationSummary = recentMsgs.reverse()
            .map(m => m.role === 'user' ? `Cliente: ${m.message}` : `Bot: ${m.message}`)
            .join('\n').substring(0, 500);

          // Send template to advisor (works outside 24hr window)
          // lead_nuevo template: {{1}}=nombre, {{2}}=telefono, {{3}}=ubicacion, {{4}}=mensaje
          const advisorMsg = await sendWhatsAppTemplate(
            store.whatsapp,
            'lead_nuevo',
            [leadName, leadPhone, storeName, `Productos: ${productsText}`]
          );

          if (advisorMsg?.error) {
            console.error(`Failed to notify advisor at ${store.whatsapp}:`, advisorMsg.error);
            // Try regular message as fallback (works if within 24hr window)
            let advisorText = `🔔 *Nuevo lead de Terra*\n\n`;
            advisorText += `👤 *${leadName}*\n`;
            advisorText += `📱 wa.me/${leadPhone}\n`;
            advisorText += `🏪 ${storeName}\n`;
            advisorText += `🏠 Productos: ${productsText}\n`;
            if (conversationSummary) advisorText += `\n💬 Conversación:\n${conversationSummary}`;

            const fallback = await sendWhatsApp(store.whatsapp, advisorText);
            if (fallback?.error) {
              console.error(`Fallback also failed for advisor ${store.whatsapp}`);
            }
          } else {
            // Template sent OK. Now send a follow-up with conversation details (within 24hr after template)
            await new Promise(r => setTimeout(r, 1000));
            if (conversationSummary) {
              let details = `📋 *Detalle del lead:*\n\n`;
              details += `👤 ${leadName} — wa.me/${leadPhone}\n`;
              details += `🏠 Productos: ${productsText}\n\n`;
              details += `💬 *Conversación:*\n${conversationSummary}`;
              await sendWhatsApp(store.whatsapp, details);
            }
          }

          // Confirm to the lead
          await sendWhatsApp(from, `¡Listo! Un asesor en *${store.name}* ya tiene tu info y te contactará en breve. 😊\n\nSi quieres escribirle directo:\nwa.me/${store.whatsapp.replace(/\D/g, '')}`);
        } else if (store?.phone) {
          await sendWhatsApp(from, `Llama a *${store.name}*: ${store.phone}. Diles que vienes de Terra. 😊`);
        } else {
          await sendWhatsApp(from, `Un asesor te atiende en tienda ahora mismo. Muéstrale este chat y te ayuda. 👍`);
        }
        if (lead) {
          await run("UPDATE leads SET status = 'contacted' WHERE id = ?", [lead.id]);
          // Schedule satisfaction survey for 24h later
          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
            [from, 'system', `[SURVEY_DUE] ${new Date(Date.now() + 24*60*60*1000).toISOString()}`]);
        }
      } else if (btnId === 'agregar_otro') {
        // Multi-product: ask for next product
        await sendWhatsApp(from, '¡Perfecto! Escríbeme el nombre del siguiente piso que necesitas y te cotizo los m². 😊');

      } else if (btnId === 'enviar_cotizacion') {
        await addLeadScore(from, 30, 'cotizacion');
        // Multi-product quote: gather all QUOTE_ITEM entries
        const quoteItems = await query(
          "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[QUOTE_ITEM]%' ORDER BY created_at ASC",
          [from]);

        if (quoteItems.length > 0) {
          const leadName = lead?.name || contactName || 'Cliente';
          let quote = `📄 *COTIZACIÓN CESANTONI*\n`;
          quote += `👤 ${leadName}\n`;
          quote += `📅 ${new Date().toLocaleDateString('es-MX')}\n`;
          quote += `${'─'.repeat(20)}\n\n`;

          let grandTotal = 0;
          let grandM2 = 0;
          for (let i = 0; i < quoteItems.length; i++) {
            const parts = quoteItems[i].message.replace('[QUOTE_ITEM] ', '').split('|');
            const [pName, pM2, pM2Merma, pBoxes, pTotalM2, pPrice] = parts;
            const price = parseFloat(pPrice) || 0;
            grandTotal += price;
            grandM2 += parseFloat(pTotalM2) || 0;

            quote += `*${i + 1}. ${pName}*\n`;
            quote += `   Área: ${pM2} m² + 10% = ${pM2Merma} m²\n`;
            quote += `   Cajas: ${pBoxes} (${pTotalM2} m²)\n`;
            if (price) quote += `   Subtotal: $${Number(price).toLocaleString('es-MX')}\n`;
            quote += `\n`;
          }
          quote += `${'─'.repeat(20)}\n`;
          quote += `📦 *Total: ${grandM2.toFixed(1)} m²*\n`;
          if (grandTotal > 0) quote += `💰 *TOTAL: $${Math.round(grandTotal).toLocaleString('es-MX')} MXN*\n`;
          quote += `\n_Precios sujetos a cambio. Vigencia: 15 días._`;

          await sendWhatsApp(from, quote);

          // Notify store advisor
          const store = lead?.store_id ? await queryOne('SELECT * FROM stores WHERE id = ?', [lead.store_id]) : null;
          if (store?.whatsapp) {
            await sendWhatsAppTemplate(store.whatsapp, 'lead_nuevo', [
              leadName, from, store?.name || 'Tienda', `Cotización ${quoteItems.length} productos: $${Math.round(grandTotal).toLocaleString('es-MX')}`
            ]);
          }

          // Clear quote items for next session
          await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[QUOTE_ITEM]%'", [from]);

          await new Promise(r => setTimeout(r, 500));
          await sendWhatsAppButtons(from, '¿Qué quieres hacer?', [
            { id: 'hablar_asesor', title: '👤 Hablar c/asesor' },
            { id: 'agendar_visita', title: '📅 Agendar visita' },
            { id: 'agregar_otro', title: '➕ Nuevo cálculo' }
          ]);
        } else {
          await sendWhatsApp(from, `Primero calcula los m² que necesitas y luego te envío la cotización. ¿Cuántos m² necesitas? 📐`);
        }

      } else if (btnId === 'agendar_visita') {
        await addLeadScore(from, 40, 'agendar_visita');
        // Store visit scheduling
        const store = lead?.store_id ? await queryOne('SELECT * FROM stores WHERE id = ?', [lead.store_id]) : null;
        const storeName = store?.name || 'la tienda';
        await sendWhatsApp(from, `📅 ¡Genial! ¿Cuándo quieres visitar *${storeName}*?\n\nDime fecha y hora aproximada, ej:\n• _Mañana a las 11am_\n• _Sábado por la tarde_\n• _Lunes 20 de febrero a las 3pm_`);
        // Mark conversation state for appointment
        await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
          [from, 'assistant', '[WAITING_APPOINTMENT]']);

      } else if (btnId === 'comparar') {
        // Product comparator: show last viewed products side by side
        const recentViewed = await query(
          "SELECT message, created_at FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[VIEWED_PRODUCT]%' ORDER BY created_at DESC LIMIT 10",
          [from]);

        // Deduplicate by product name, keep most recent
        const seen = new Set();
        const uniqueNames = [];
        for (const r of recentViewed) {
          const name = r.message.replace('[VIEWED_PRODUCT] ', '').trim();
          if (!seen.has(name)) {
            seen.add(name);
            uniqueNames.push(name);
          }
          if (uniqueNames.length >= 3) break;
        }

        if (uniqueNames.length >= 2) {
          const compareProducts = [];
          for (const n of uniqueNames) {
            const p = await queryOne('SELECT name, base_price, format, finish, pei, usage, sqm_per_box FROM products WHERE name ILIKE ? OR sku ILIKE ?', [`%${n}%`, `%${n}%`]);
            if (p) compareProducts.push(p);
          }
          if (compareProducts.length >= 2) {
            let comp = `⚖️ *COMPARADOR*\n${'─'.repeat(20)}\n\n`;
            for (const p of compareProducts) {
              comp += `*${p.name}*\n`;
              comp += `  💰 $${p.base_price || '?'}/m²\n`;
              comp += `  📐 ${p.format || '-'}\n`;
              comp += `  ✨ ${p.finish || '-'}\n`;
              comp += `  💪 PEI ${p.pei || '-'}\n`;
              comp += `  🏠 ${p.usage || '-'}\n`;
              comp += `  📦 ${p.sqm_per_box || '-'} m²/caja\n\n`;
            }
            comp += `¿Cuál prefieres? Escríbeme el nombre para cotizar. 😊`;
            await sendWhatsApp(from, comp);
          } else {
            await sendWhatsApp(from, 'Necesito al menos 2 productos para comparar. Escríbeme el nombre de un piso para empezar. 😊');
          }
        } else {
          await sendWhatsApp(from, 'Necesito al menos 2 productos para comparar. Escríbeme el nombre de un piso que te interese. 😊');
        }

      } else if (btnId.startsWith('survey_')) {
        // Satisfaction survey response
        const rating = parseInt(btnId.replace('survey_', '')) || 3;
        const ratingLabel = rating >= 5 ? 'Excelente' : rating >= 3 ? 'Regular' : 'Necesita mejorar';
        const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
        if (lead) {
          await run("UPDATE leads SET notes = COALESCE(notes, '') || ? WHERE id = ?",
            [`\n⭐ Encuesta: ${rating}/5 (${ratingLabel}) - ${new Date().toLocaleDateString('es-MX')}`, lead.id]);
        }
        await sendWhatsApp(from, `¡Gracias por tu calificación! ${rating >= 4 ? '😊' : 'Tomaremos en cuenta tu opinión para mejorar. 🙏'}\n\n¿Te puedo ayudar con algo más?`);

      } else if (btnId.startsWith('cat_')) {
        // Catalog list reply: user selected a product from the list
        const catRef = btnId.replace('cat_', '');
        const selectedProduct = await queryOne('SELECT * FROM products WHERE sku = ? OR slug = ? OR id::text = ?', [catRef, catRef, catRef]);
        if (selectedProduct) {
          await addLeadScore(from, 10, 'catalog_select');
          const baseUrl = 'https://cesantoni-experience-za74.onrender.com';
          const link = `${baseUrl}/p/${selectedProduct.sku || selectedProduct.slug}`;
          const pei = parseInt(selectedProduct.pei) || 0;
          const peiTip = pei >= 4 ? 'Alto tráfico' : pei >= 3 ? 'Toda la casa' : pei >= 2 ? 'Tráfico ligero' : '';
          let caption = `*${selectedProduct.name}*\n\n`;
          caption += `💰 *$${selectedProduct.base_price || '?'}/m²*\n`;
          caption += `📐 Formato: ${selectedProduct.format || '-'}\n`;
          caption += `✨ Acabado: ${selectedProduct.finish || '-'}\n`;
          if (pei) caption += `💪 PEI ${pei} — ${peiTip}\n`;
          if (selectedProduct.usage) caption += `🏠 Uso: ${selectedProduct.usage}\n`;
          if (selectedProduct.sqm_per_box) caption += `📦 ${selectedProduct.sqm_per_box} m²/caja\n`;
          caption += `\n🔗 Ver detalles: ${link}`;

          if (selectedProduct.image_url) {
            await sendWhatsAppImage(from, selectedProduct.image_url, caption);
          } else {
            await sendWhatsApp(from, caption);
          }

          // Track product view
          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
            [from, 'assistant', `[VIEWED_PRODUCT] ${selectedProduct.name}`]);

          // Update lead products
          if (lead) {
            const prods = lead.products_interested ? JSON.parse(lead.products_interested) : [];
            if (!prods.includes(selectedProduct.name)) {
              prods.push(selectedProduct.name);
              await run('UPDATE leads SET products_interested = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(prods), lead.id]);
            }
          }

          await new Promise(r => setTimeout(r, 500));
          await sendWhatsAppButtons(from, '¿Qué te gustaría hacer?', [
            { id: 'calcular_m2', title: '📐 Calcular m²' },
            { id: 'ver_mas_catalogo', title: '📋 Ver más pisos' },
            { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
          ]);
        } else {
          await sendWhatsApp(from, `No encontré ese producto. Escríbeme el nombre del piso que te interesa. 😊`);
        }

      } else if (btnId === 'ver_mas_catalogo') {
        // Re-show the last catalog list
        const lastCat = await queryOne(
          "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'system' AND message LIKE '[LAST_CATALOG]%' ORDER BY created_at DESC LIMIT 1",
          [from]);
        if (lastCat) {
          const catSearch = lastCat.message.replace('[LAST_CATALOG] ', '').trim();
          const isWood = /madera|wood/i.test(catSearch);
          const isMarble = /m[aá]rmol|marble/i.test(catSearch);
          const isStone = /piedra|stone/i.test(catSearch);
          let catProducts = [];
          if (isWood) {
            catProducts = await query(`SELECT * FROM products WHERE active = 1 AND (
              name ILIKE '%wood%' OR format ILIKE '%20 x 120%' OR format ILIKE '%20 x 160%' OR format ILIKE '%26 x 160%'
              OR description ILIKE '%madera%') ORDER BY RANDOM() LIMIT 10`);
          } else if (isMarble) {
            catProducts = await query(`SELECT * FROM products WHERE active = 1 AND (
              description ILIKE '%m_rmol%' OR description ILIKE '%marble%' OR description ILIKE '%calacatta%'
              OR name ILIKE '%calacatta%' OR name ILIKE '%bianco%' OR name ILIKE '%quarzo%'
              OR ((format ILIKE '%60x120%' OR format ILIKE '%60 x 120%' OR format ILIKE '%80x160%' OR format ILIKE '%80 x 160%')
                  AND (finish ILIKE '%BRILLANTE%' OR finish ILIKE '%PULIDO%' OR finish ILIKE '%SATINADO%')))
              AND name NOT ILIKE '%wood%' AND name NOT ILIKE '%mutina%' AND name NOT ILIKE '%maple%'
              AND format NOT ILIKE '%20 x 120%' AND format NOT ILIKE '%20 x 160%' AND format NOT ILIKE '%26 x 160%'
              ORDER BY RANDOM() LIMIT 10`);
          } else if (isStone) {
            catProducts = await query(`SELECT * FROM products WHERE active = 1 AND (
              description ILIKE '%piedra%' OR description ILIKE '%stone%' OR description ILIKE '%roca%'
              OR name ILIKE '%piatra%' OR name ILIKE '%coral%') ORDER BY RANDOM() LIMIT 10`);
          } else {
            catProducts = await query(
              'SELECT * FROM products WHERE active = 1 AND (name ILIKE ? OR finish ILIKE ? OR usage ILIKE ? OR description ILIKE ?) ORDER BY RANDOM() LIMIT 10',
              [`%${catSearch}%`, `%${catSearch}%`, `%${catSearch}%`, `%${catSearch}%`]);
          }
          if (catProducts.length > 0) {
            const listRows = catProducts.map(s => ({
              id: `cat_${s.sku || s.slug || s.id}`,
              title: s.name,
              description: `$${s.base_price || '?'}/m² · ${s.format || ''} · ${s.finish || ''}`
            }));
            await sendWhatsAppList(from,
              `🏠 *Más pisos estilo ${catSearch}* — ${catProducts.length} opciones.\nSelecciona los que te interesen:`,
              'Ver pisos',
              [{ title: `Estilo ${catSearch}`, rows: listRows }]);
          } else {
            await sendWhatsApp(from, `No encontré más pisos de ese estilo. ¿Quieres probar otro? _madera, mármol, piedra, exterior..._ 😊`);
          }
        } else {
          await sendWhatsApp(from, '¿Qué estilo de piso buscas? Dime por ejemplo: _pisos de madera_, _pisos de mármol_, _pisos para exterior_ 😊');
        }

      } else {
        // Unknown button, pass to AI
        const reply = await processWhatsAppMessage(from, btnTitle, contactName);
        await sendWhatsApp(from, reply);
      }

    } else if (message.type === 'audio') {
      // Voice note: transcribe with Gemini then process as text
      const audioId = message.audio?.id;
      if (audioId) {
        await sendWhatsApp(from, 'Escuchando tu audio... 🎧');
        const media = await downloadWhatsAppMedia(audioId);
        if (media) {
          const transcription = await transcribeAudio(media.buffer, media.mimeType);
          if (transcription) {
            console.log(`🎤 Transcription from ${from}: "${transcription}"`);
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', `[Audio] ${transcription}`]);

            // Process transcribed text through normal AI flow
            const reply = await processWhatsAppMessage(from, transcription, contactName);
            await sendWhatsApp(from, reply);

            // Check if reply mentions a product
            const slugMatch = reply.match(/\/p\/([A-Za-z0-9_-]+)/i);
            if (slugMatch) {
              const pSlug = slugMatch[1];
              const product = await queryOne('SELECT name, image_url FROM products WHERE slug ILIKE ? OR sku ILIKE ?', [pSlug, pSlug]);
              if (product?.image_url) await sendWhatsAppImage(from, product.image_url, `${product.name} - Cesantoni`);
            }
          } else {
            await sendWhatsApp(from, 'No pude entender el audio. ¿Podrías escribirme tu mensaje? 🙏');
          }
        } else {
          await sendWhatsApp(from, 'No pude descargar el audio. Intenta de nuevo o escríbeme tu pregunta. 🙏');
        }
      }

    } else if (message.type === 'image') {
      // Image: analyze with Gemini Vision and suggest similar products
      const imageId = message.image?.id;
      if (imageId) {
        await sendWhatsApp(from, 'Analizando tu imagen... 🔍');
        const media = await downloadWhatsAppMedia(imageId);
        if (media) {
          const analysis = await analyzeFloorImage(media.buffer, media.mimeType);
          if (analysis) {
            console.log(`🖼️ Image analysis from ${from}:`, analysis);
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', `[Imagen] Piso tipo: ${analysis.look}, color: ${analysis.color}`]);

            // Build search query based on analysis
            const lookMap = { madera: 'MADERA', marmol: 'MÁRMOL', piedra: 'PIEDRA', cemento: 'CEMENTO', concreto: 'CEMENTO' };
            const colorMap = { claro: 'CLARO', oscuro: 'OSCURO', gris: 'GRIS', beige: 'BEIGE', blanco: 'BLANCO', cafe: 'CAFÉ', marron: 'CAFÉ' };
            const lookTerm = lookMap[analysis.look?.toLowerCase()] || analysis.look || '';
            const colorTerm = colorMap[analysis.color?.toLowerCase()] || analysis.color || '';

            // Search for similar products
            let matches = await query(
              `SELECT id, name, base_price, format, finish, sku, slug, image_url, pei, usage, category
               FROM products WHERE active = 1 AND (
                 category ILIKE ? OR finish ILIKE ? OR name ILIKE ? OR description ILIKE ?
               ) ORDER BY RANDOM() LIMIT 3`,
              [`%${lookTerm}%`, `%${analysis.finish || ''}%`, `%${lookTerm}%`, `%${lookTerm}%`]
            );

            if (matches.length === 0) {
              matches = await query('SELECT id, name, base_price, format, finish, sku, slug, image_url, pei, usage FROM products WHERE active = 1 ORDER BY RANDOM() LIMIT 3');
            }

            const baseUrl = 'https://cesantoni-experience-za74.onrender.com';
            const lookDesc = `${lookTerm ? 'tipo ' + lookTerm.toLowerCase() : ''} ${colorTerm ? 'color ' + colorTerm.toLowerCase() : ''}`.trim();
            await sendWhatsApp(from, `Veo un piso ${lookDesc || 'interesante'}. Te muestro opciones similares de Cesantoni:`);
            await new Promise(r => setTimeout(r, 500));

            for (const s of matches) {
              const link = `${baseUrl}/p/${s.sku || s.slug}`;
              let caption = `*${s.name}* · $${s.base_price || '?'}/m²\n`;
              caption += `📐 ${s.format || ''} · ✨ ${s.finish || ''}\n`;
              if (s.pei) caption += `💪 PEI ${s.pei}\n`;
              caption += `\n🔗 ${link}`;
              if (s.image_url) await sendWhatsAppImage(from, s.image_url, caption);
              else await sendWhatsApp(from, caption);
              await new Promise(r => setTimeout(r, 800));
            }

            await sendWhatsApp(from, '¿Alguno se parece a lo que buscas? 😊');
          } else {
            await sendWhatsApp(from, 'No pude analizar la imagen. ¿Podrías describirme qué tipo de piso buscas? (madera, mármol, piedra...) 🤔');
          }
        }
      }

    } else if (message.type === 'document') {
      await sendWhatsApp(from, 'Gracias por el documento. Soy Terra, tu asesora de pisos Cesantoni. ¿En qué te puedo ayudar? 😊');
    } else {
      await sendWhatsApp(from, '¡Hola! Soy Terra, tu asesora de pisos Cesantoni. Escríbeme lo que buscas y te ayudo. 😊');
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

// WhatsApp conversations API (for CRM dashboard)
app.get('/api/wa/conversations', async (req, res) => {
  try {
    const conversations = await query(`
      SELECT phone,
             MAX(CASE WHEN role='user' THEN message END) as last_message,
             COUNT(*) as total_messages,
             MIN(created_at) as first_contact,
             MAX(created_at) as last_contact
      FROM wa_conversations
      GROUP BY phone
      ORDER BY MAX(created_at) DESC
      LIMIT 50
    `);
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wa/conversation/:phone', async (req, res) => {
  try {
    const messages = await query(
      'SELECT role, message, created_at FROM wa_conversations WHERE phone = ? ORDER BY created_at ASC',
      [req.params.phone]
    );
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// LEADS API
// =====================================================

app.get('/api/leads', async (req, res) => {
  try {
    const { status, source, days } = req.query;
    const d = parseInt(days) || 90;
    let sql = `SELECT l.*,
      s.name as store_full_name, s.city as store_city, s.state as store_state, s.address as store_address,
      s.whatsapp as store_whatsapp, s.phone as store_phone, s.manager_name as store_manager,
      d.name as distributor_name
      FROM leads l
      LEFT JOIN stores s ON l.store_id = s.id
      LEFT JOIN distributors d ON s.distributor_id = d.id
      WHERE l.created_at >= NOW() - INTERVAL '${d} days'`;
    const params = [];
    if (status) { sql += ' AND l.status = ?'; params.push(status); }
    if (source) { sql += ' AND l.source = ?'; params.push(source); }
    sql += ' ORDER BY l.created_at DESC LIMIT 200';
    res.json(await query(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/:id', async (req, res) => {
  try {
    const lead = await queryOne(`SELECT l.*,
      s.name as store_full_name, s.city as store_city, s.state as store_state, s.address as store_address,
      s.whatsapp as store_whatsapp, s.phone as store_phone, s.manager_name as store_manager, s.slug as store_slug,
      d.name as distributor_name
      FROM leads l
      LEFT JOIN stores s ON l.store_id = s.id
      LEFT JOIN distributors d ON s.distributor_id = d.id
      WHERE l.id = ?`, [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Get product details
    let products_detail = [];
    try {
      const prods = JSON.parse(lead.products_interested || '[]');
      products_detail = await Promise.all(prods.map(async pName => {
        const p = await queryOne('SELECT id, name, sku, slug, base_price, format, finish, image_url, usage FROM products WHERE name ILIKE ?', [`%${pName.toLowerCase()}%`]);
        return p || { name: pName };
      }));
    } catch(e) {}

    // WA conversation
    let conversation = [];
    if (lead.phone) {
      conversation = await query('SELECT role, message, created_at FROM wa_conversations WHERE phone = ? ORDER BY created_at ASC', [lead.phone]);
    }
    res.json({ ...lead, products_detail, conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/leads/:id', crmAuth, async (req, res) => {
  try {
    const { status, notes, advisor_name } = req.body;
    const lead = await queryOne('SELECT id FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (status) await run('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, req.params.id]);
    if (notes) await run('UPDATE leads SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [notes, req.params.id]);
    if (advisor_name !== undefined) await run('UPDATE leads SET advisor_name = ?, assigned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [advisor_name || null, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV Export
app.get('/api/leads/export/csv', crmAuth, async (req, res) => {
  try {
    const { status, source, days } = req.query;
    const d = parseInt(days) || 365;
    let sql = `SELECT l.*, s.name as store_name_full, s.city as store_city, s.state as store_state, d.name as distributor
      FROM leads l LEFT JOIN stores s ON l.store_id = s.id LEFT JOIN distributors d ON s.distributor_id = d.id
      WHERE l.created_at >= NOW() - INTERVAL '${d} days'`;
    const params = [];
    if (status) { sql += ' AND l.status = ?'; params.push(status); }
    if (source) { sql += ' AND l.source = ?'; params.push(source); }
    sql += ' ORDER BY l.created_at DESC';
    const leads = await query(sql, params);

    const header = 'ID,Nombre,Teléfono,Fuente,Status,Score,Tienda,Ciudad,Estado,Distribuidor,Productos,Notas,Creado,Actualizado\n';
    const rows = leads.map(l => {
      const prods = (l.products_interested || '').replace(/"/g, '""');
      const notes = (l.notes || '').replace(/"/g, '""').replace(/\n/g, ' ');
      return `${l.id},"${l.name || ''}","${l.phone || ''}","${l.source}","${l.status}",${l.score || 0},"${l.store_name_full || ''}","${l.store_city || ''}","${l.store_state || ''}","${l.distributor || ''}","${prods}","${notes}","${l.created_at || ''}","${l.updated_at || ''}"`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=leads_cesantoni_${new Date().toISOString().split('T')[0]}.csv`);
    res.send('\uFEFF' + header + rows); // BOM for Excel
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bot Analytics
app.get('/api/analytics/bot', async (req, res) => {
  try {
    const d = parseInt(req.query.days) || 30;

    // Top products searched
    const topProducts = await query(`
      SELECT message, COUNT(*) as views FROM wa_conversations
      WHERE role = 'assistant' AND message LIKE '[VIEWED_PRODUCT]%'
      AND created_at >= NOW() - INTERVAL '${d} days'
      GROUP BY message ORDER BY views DESC LIMIT 10`);

    // Messages per day
    const msgsPerDay = await query(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM wa_conversations WHERE created_at >= NOW() - INTERVAL '${d} days'
      GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30`);

    // Leads by source
    const leadsBySource = await query(`
      SELECT source, COUNT(*) as count FROM leads
      WHERE created_at >= NOW() - INTERVAL '${d} days'
      GROUP BY source ORDER BY count DESC`);

    // Leads by status
    const leadsByStatus = await query(`
      SELECT status, COUNT(*) as count FROM leads
      WHERE created_at >= NOW() - INTERVAL '${d} days'
      GROUP BY status ORDER BY count DESC`);

    // Conversion rates
    const totalLeads = await queryOne(`SELECT COUNT(*) as c FROM leads WHERE created_at >= NOW() - INTERVAL '${d} days'`);
    const contacted = await queryOne(`SELECT COUNT(*) as c FROM leads WHERE status IN ('contacted','converted','appointment') AND created_at >= NOW() - INTERVAL '${d} days'`);
    const converted = await queryOne(`SELECT COUNT(*) as c FROM leads WHERE status = 'converted' AND created_at >= NOW() - INTERVAL '${d} days'`);

    // Average score
    const avgScore = await queryOne(`SELECT ROUND(AVG(COALESCE(score, 0))) as avg FROM leads WHERE created_at >= NOW() - INTERVAL '${d} days'`);

    // Top categories (from catalog searches)
    const topCategories = await query(`
      SELECT message, COUNT(*) as count FROM wa_conversations
      WHERE role = 'user' AND (message ILIKE '%pisos de%' OR message ILIKE '%pisos para%')
      AND created_at >= NOW() - INTERVAL '${d} days'
      GROUP BY message ORDER BY count DESC LIMIT 5`);

    res.json({
      topProducts: topProducts.map(r => ({ name: r.message.replace('[VIEWED_PRODUCT] ', ''), views: parseInt(r.views) })),
      msgsPerDay: msgsPerDay.map(r => ({ day: r.day, count: parseInt(r.count) })),
      leadsBySource, leadsByStatus,
      conversionRate: {
        total: parseInt(totalLeads?.c || 0),
        contacted: parseInt(contacted?.c || 0),
        converted: parseInt(converted?.c || 0),
        contactRate: totalLeads?.c > 0 ? ((contacted?.c / totalLeads.c) * 100).toFixed(1) : 0,
        convertRate: totalLeads?.c > 0 ? ((converted?.c / totalLeads.c) * 100).toFixed(1) : 0,
      },
      avgScore: parseInt(avgScore?.avg || 0),
      topCategories
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New leads notification (polling)
app.get('/api/leads/new/count', async (req, res) => {
  try {
    const since = req.query.since || new Date(Date.now() - 60*60*1000).toISOString();
    const result = await queryOne("SELECT COUNT(*) as c FROM leads WHERE created_at > ?", [since]);
    const recent = await query("SELECT id, name, phone, source, created_at FROM leads WHERE created_at > ? ORDER BY created_at DESC LIMIT 5", [since]);
    res.json({ count: parseInt(result?.c || 0), recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WhatsApp Broadcast
app.post('/api/broadcast', crmAuth, async (req, res) => {
  try {
    const { template, params, filter } = req.body;
    if (!template) return res.status(400).json({ error: 'Template name required' });

    let sql = "SELECT DISTINCT phone, name FROM leads WHERE phone IS NOT NULL AND phone != ''";
    const qParams = [];
    if (filter?.source) { sql += ' AND source = ?'; qParams.push(filter.source); }
    if (filter?.status) { sql += ' AND status = ?'; qParams.push(filter.status); }
    if (filter?.minScore) { sql += ' AND COALESCE(score, 0) >= ?'; qParams.push(parseInt(filter.minScore)); }
    const leads = await query(sql, qParams);

    let sent = 0, failed = 0;
    for (const lead of leads) {
      try {
        const p = (params || []).map(t => t.replace('{{nombre}}', lead.name || 'Cliente'));
        await sendWhatsAppTemplate(lead.phone, template, p);
        sent++;
        await new Promise(r => setTimeout(r, 1000)); // Rate limit
      } catch (e) {
        failed++;
      }
    }
    res.json({ total: leads.length, sent, failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// STORE INVENTORY
// =====================================================

// Get inventory for a store
app.get('/api/stores/:id/inventory', async (req, res) => {
  try {
    const items = await query(`
      SELECT si.*, p.name as product_name, p.sku, p.format, p.base_price, p.image_url
      FROM store_inventory si
      JOIN products p ON si.product_id = p.id
      WHERE si.store_id = ?
      ORDER BY p.name`, [req.params.id]);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update inventory (bulk)
app.put('/api/stores/:id/inventory', crmAuth, async (req, res) => {
  try {
    const { products } = req.body; // [{ product_id, in_stock }]
    if (!Array.isArray(products)) return res.status(400).json({ error: 'products array required' });
    for (const p of products) {
      await run(`INSERT INTO store_inventory (store_id, product_id, in_stock, updated_at)
        VALUES (?, ?, ?, NOW())
        ON CONFLICT (store_id, product_id) DO UPDATE SET in_stock = ?, updated_at = NOW()`,
        [req.params.id, p.product_id, p.in_stock, p.in_stock]);
    }
    res.json({ success: true, updated: products.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =====================================================
// FUNNEL ANALYTICS
// =====================================================

app.get('/api/funnel', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const dateFilter = `NOW() - INTERVAL '${days} days'`;

    const scans = await scalar(`SELECT COUNT(*) FROM scans WHERE created_at >= ${dateFilter}`) || 0;
    const waClicks = await scalar(`SELECT COUNT(*) FROM whatsapp_clicks WHERE created_at >= ${dateFilter}`) || 0;
    const totalLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE created_at >= ${dateFilter}`) || 0;
    const landingLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE source = 'landing' AND created_at >= ${dateFilter}`) || 0;
    const terraLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE source = 'terra_qr' AND created_at >= ${dateFilter}`) || 0;
    const waLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE source = 'whatsapp_bot' AND created_at >= ${dateFilter}`) || 0;
    const contacted = await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'contacted' AND created_at >= ${dateFilter}`) || 0;
    const converted = await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'converted' AND created_at >= ${dateFilter}`) || 0;

    // Daily breakdown for chart
    const daily = await query(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM scans WHERE created_at >= ${dateFilter}
      GROUP BY date(created_at) ORDER BY day
    `);
    const dailyLeads = await query(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM leads WHERE created_at >= ${dateFilter}
      GROUP BY date(created_at) ORDER BY day
    `);

    // Top products scanned
    const topProducts = await query(`
      SELECT p.name, COUNT(s.id) as scans
      FROM scans s JOIN products p ON s.product_id = p.id
      WHERE s.created_at >= ${dateFilter}
      GROUP BY p.name ORDER BY scans DESC LIMIT 10
    `);

    res.json({
      period_days: days,
      funnel: { scans, wa_clicks: waClicks, leads: totalLeads, contacted, converted },
      leads_by_source: { landing: landingLeads, terra_qr: terraLeads, whatsapp_bot: waLeads },
      conversion_rates: {
        scan_to_click: scans > 0 ? ((waClicks / scans) * 100).toFixed(1) : '0',
        click_to_lead: waClicks > 0 ? ((totalLeads / waClicks) * 100).toFixed(1) : '0',
        lead_to_contacted: totalLeads > 0 ? ((contacted / totalLeads) * 100).toFixed(1) : '0',
        lead_to_converted: totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0'
      },
      daily_scans: daily,
      daily_leads: dailyLeads,
      top_products: topProducts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// AI CHAT - Asistente Cesantoni
// =====================================================

app.post('/api/chat', async (req, res) => {
  try {
    const { message, product, store } = req.body;

    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'API no configurada' });
    }

    // Build context about the product
    let context = `Eres un asistente de ventas experto de Cesantoni, una empresa mexicana de pisos y porcelanatos premium.
Responde de manera amable, profesional y concisa en español mexicano.
Usa un tono cálido pero profesional. Respuestas cortas (máximo 3 oraciones).

INFORMACIÓN DE CESANTONI:
- Empresa mexicana con más de 25 años de experiencia
- Pisos porcelánicos, pasta blanca y rectificados
- Garantía de calidad premium
- Envíos a toda la república mexicana

`;

    if (product) {
      context += `
PRODUCTO ACTUAL QUE EL CLIENTE ESTÁ VIENDO:
- Nombre: ${product.name}
- Categoría: ${product.category || 'Porcelánico'}
- Tipo: ${product.type || 'Porcelánico Rectificado'}
- Formato: ${product.format || 'Formato estándar'}
- Acabado: ${product.finish || 'Acabado premium'}
- Precio: $${product.price}/m²
- Descripción: ${product.description || 'Piso de alta calidad'}
- Resistencia: ${product.pei || product.resistance || 'Alta resistencia'}
- Usos: ${product.uses || 'Interior y exterior'}
`;
    }

    if (store) {
      context += `
TIENDA DONDE ESTÁ EL CLIENTE:
- Nombre: ${store.name}
- Dirección: ${store.address}, ${store.city}, ${store.state}
- Teléfono: ${store.phone || store.whatsapp || 'Disponible en tienda'}
`;
    }

    context += `
TEMAS QUE PUEDES RESPONDER:
- Características del producto (resistencia, durabilidad, etc.)
- Instalación y mantenimiento
- Precios y promociones
- Disponibilidad y envíos
- Comparación con otros productos
- Recomendaciones según el espacio (baño, cocina, sala, exterior)
- Garantía y devoluciones

Si no sabes algo específico, sugiere contactar a un asesor por WhatsApp.
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: context },
              { text: `Cliente pregunta: ${message}` }
            ]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 200
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error('Gemini error:', data.error);
      return res.status(500).json({ error: 'Error al procesar tu pregunta' });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ||
                  'Lo siento, no pude procesar tu pregunta. ¿Podrías reformularla?';

    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Error en el chat' });
  }
});

// =====================================================
// INICIO
// =====================================================

// Sync video URLs from GCS on startup (Render wipes filesystem on restart)
async function syncVideosFromGCS() {
  if (!gcsBucket) return;
  try {
    console.log('🔄 Sincronizando videos desde GCS...');
    const [files] = await gcsBucket.getFiles({ prefix: 'videos/' });
    const videoFiles = files.filter(f => f.name.endsWith('.mp4'));
    console.log(`📦 ${videoFiles.length} videos encontrados en GCS`);

    const products = await query('SELECT id, name, slug, video_url FROM products');
    let updated = 0;

    for (const file of videoFiles) {
      const filename = file.name.replace('videos/', '').replace('.mp4', '');
      const gcsUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${file.name}`;

      // Find matching product by slug or name
      const product = products.find(p => {
        const slug = (p.slug || p.name || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
        const slugDash = (p.slug || p.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
        return filename === slug || filename === slugDash || filename === p.slug;
      });

      if (product && !product.video_url) {
        await run('UPDATE products SET video_url = ? WHERE id = ?', [gcsUrl, product.id]);
        updated++;
      }
    }

    console.log(`✅ Sync GCS: ${updated} video_urls actualizados`);
  } catch (err) {
    console.log('⚠️ Error sync GCS:', err.message);
  }
}

async function start() {
  await initDB();
  await syncVideosFromGCS();

  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🏠 CESANTONI EXPERIENCE - Sistema QR + Video        ║
║                                                       ║
║   Dashboard:  http://localhost:${PORT}                  ║
║   API Docs:   http://localhost:${PORT}/api              ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
  });

  // HTTPS server for camera access on mobile
  try {
    const sslKey = fs.readFileSync(path.join(__dirname, 'key.pem'));
    const sslCert = fs.readFileSync(path.join(__dirname, 'cert.pem'));
    const HTTPS_PORT = 3443;
    https.createServer({ key: sslKey, cert: sslCert }, app).listen(HTTPS_PORT, () => {
      console.log(`   🔒 HTTPS: https://192.168.100.5:${HTTPS_PORT}\n`);
    });
  } catch (e) {
    console.log('   (HTTPS not available - no cert files)');
  }

  // CRON: Follow-up with leads that haven't been contacted (every 2 hours)
  setInterval(async () => {
    try {
      // Find leads created 24+ hours ago that are still 'new' (never contacted)
      const staleLeads = await query(`
        SELECT l.*, s.whatsapp as store_whatsapp, s.name as store_display_name
        FROM leads l
        LEFT JOIN stores s ON l.store_id = s.id
        WHERE l.status = 'new'
          AND l.created_at < NOW() - INTERVAL '24 hours'
          AND l.created_at > NOW() - INTERVAL '72 hours'
          AND l.phone IS NOT NULL
      `);

      if (staleLeads.length === 0) return;
      console.log(`⏰ CRON: ${staleLeads.length} leads pending follow-up`);

      for (const lead of staleLeads) {
        const prods = lead.products_interested ? JSON.parse(lead.products_interested) : [];
        const prodName = prods[0] || 'pisos Cesantoni';

        // Check last bot message to this lead
        const lastMsg = await queryOne(
          "SELECT created_at FROM wa_conversations WHERE phone = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1",
          [lead.phone]);

        // Don't send if we already messaged within 12 hours
        if (lastMsg) {
          const hoursSinceLastMsg = (Date.now() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceLastMsg < 12) continue;
        }

        // Send follow-up via template (safe outside 24hr window)
        const followUp = await sendWhatsAppTemplate(
          lead.phone,
          'lead_nuevo',
          [
            lead.name || 'Cliente',
            lead.phone,
            lead.store_name || 'Cesantoni',
            `Seguimiento: ¿Sigues interesado en ${prodName}?`
          ]
        );

        if (!followUp?.error) {
          await run("UPDATE leads SET status = 'follow_up', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [lead.id]);
          console.log(`  📩 Follow-up sent to ${lead.name || lead.phone} for ${prodName}`);
        }

        await new Promise(r => setTimeout(r, 2000)); // Rate limit
      }
    } catch (e) {
      console.error('CRON follow-up error:', e.message);
    }
  }, 2 * 60 * 60 * 1000); // Every 2 hours

  console.log('   ⏰ CRON follow-up active (every 2h)');

  // CRON: Satisfaction survey (every 1 hour, sends survey to leads contacted 24h+ ago)
  setInterval(async () => {
    try {
      const dueSurveys = await query(
        "SELECT DISTINCT phone, message FROM wa_conversations WHERE role = 'system' AND message LIKE '[SURVEY_DUE]%'");

      for (const row of dueSurveys) {
        const dueDate = row.message.replace('[SURVEY_DUE] ', '');
        if (new Date(dueDate) > new Date()) continue; // Not due yet

        // Delete the marker first (mark-before-send)
        await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'system' AND message LIKE '[SURVEY_DUE]%'", [row.phone]);

        await sendWhatsAppButtons(row.phone,
          '⭐ ¿Cómo fue tu experiencia con nuestro asesor? Tu opinión nos ayuda a mejorar.',
          [
            { id: 'survey_5', title: '⭐⭐⭐⭐⭐ Excelente' },
            { id: 'survey_3', title: '⭐⭐⭐ Regular' },
            { id: 'survey_1', title: '⭐ Mala' }
          ]
        );
        console.log(`📊 Survey sent to ${row.phone}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error('CRON survey error:', e.message);
    }
  }, 60 * 60 * 1000); // Every 1 hour
  console.log('   📊 CRON survey active (every 1h)');

  // CRON: Abandoned cart recovery (every 3 hours)
  // Finds leads who calculated m² but never clicked hablar_asesor within 48h
  setInterval(async () => {
    try {
      // Leads with QUOTE_ITEM or m² calc but no 'contacted' status, created 24-72h ago
      const abandoned = await query(`
        SELECT DISTINCT l.id, l.phone, l.name, l.products_interested
        FROM leads l
        JOIN wa_conversations wc ON wc.phone = l.phone
        WHERE l.status = 'new'
        AND l.created_at BETWEEN NOW() - INTERVAL '72 hours' AND NOW() - INTERVAL '24 hours'
        AND (wc.message LIKE '[QUOTE_ITEM]%' OR wc.message LIKE '%Cotización%')
        AND wc.role = 'assistant'
        AND NOT EXISTS (
          SELECT 1 FROM wa_conversations w2
          WHERE w2.phone = l.phone AND w2.role = 'assistant'
          AND w2.message LIKE '%abandoned_reminder%'
        )
        LIMIT 10`);

      for (const lead of abandoned) {
        let prodName = 'Pisos Cesantoni';
        try { prodName = JSON.parse(lead.products_interested || '[]')[0] || prodName; } catch(e) {}

        // Mark before send
        await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
          [lead.phone, 'assistant', '[abandoned_reminder]']);

        await sendWhatsAppTemplate(lead.phone, 'lead_nuevo', [
          lead.name || 'Cliente', lead.phone, 'Cesantoni',
          `¿Aún interesado en ${prodName}? Tu cotización te espera`
        ]);

        console.log(`🛒 Abandoned cart reminder sent to ${lead.name || lead.phone}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error('CRON abandoned cart error:', e.message);
    }
  }, 3 * 60 * 60 * 1000); // Every 3 hours
  console.log('   🛒 CRON abandoned cart active (every 3h)');

  // CRON: Daily summary to manager (every 1h, sends at ~9am Mexico time)
  setInterval(async () => {
    try {
      const now = new Date();
      const mxHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })).getHours();
      if (mxHour !== 9) return; // Only at 9am Mexico time

      // Check if already sent today
      const today = new Date().toISOString().split('T')[0];
      const alreadySent = await queryOne(
        "SELECT id FROM wa_conversations WHERE phone = ? AND role = 'system' AND message LIKE ? AND created_at::date = CURRENT_DATE",
        [MANAGER_PHONE, '[DAILY_SUMMARY]%']);
      if (alreadySent) return;

      // Mark before send
      await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
        [MANAGER_PHONE, 'system', `[DAILY_SUMMARY] ${today}`]);

      // Gather stats
      const newLeads24h = await scalar("SELECT COUNT(*) FROM leads WHERE created_at >= NOW() - INTERVAL '24 hours'") || 0;
      const totalLeads = await scalar("SELECT COUNT(*) FROM leads") || 0;
      const contacted = await scalar("SELECT COUNT(*) FROM leads WHERE status = 'contacted'") || 0;
      const converted = await scalar("SELECT COUNT(*) FROM leads WHERE status = 'converted'") || 0;
      const msgs24h = await scalar("SELECT COUNT(*) FROM wa_conversations WHERE created_at >= NOW() - INTERVAL '24 hours'") || 0;
      const topProduct = await queryOne(`
        SELECT message, COUNT(*) as c FROM wa_conversations
        WHERE role = 'assistant' AND message LIKE '[VIEWED_PRODUCT]%'
        AND created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY message ORDER BY c DESC LIMIT 1`);
      const topProd = topProduct ? topProduct.message.replace('[VIEWED_PRODUCT] ', '') : 'N/A';
      const pendingLeads = await scalar("SELECT COUNT(*) FROM leads WHERE status = 'new' AND created_at < NOW() - INTERVAL '24 hours'") || 0;

      const summary = `📊 *Resumen Diario Cesantoni*\n${today}\n${'─'.repeat(20)}\n\n` +
        `🆕 Nuevos leads (24h): *${newLeads24h}*\n` +
        `📋 Total leads: *${totalLeads}*\n` +
        `📞 Contactados: *${contacted}*\n` +
        `✅ Convertidos: *${converted}*\n` +
        `💬 Mensajes (24h): *${msgs24h}*\n` +
        `🏆 Top producto: *${topProd}*\n` +
        `⚠️ Pendientes +24h: *${pendingLeads}*\n\n` +
        `Dashboard: https://cesantoni-experience-za74.onrender.com`;

      await sendWhatsApp(MANAGER_PHONE, summary);
      console.log(`📊 Daily summary sent to manager`);
    } catch (e) {
      console.error('CRON daily summary error:', e.message);
    }
  }, 60 * 60 * 1000); // Check every hour
  console.log('   📊 CRON daily summary active (9am MX)');
}

start().catch(console.error);
module.exports = app;
// Force redeploy Thu Feb  5 10:30:47 CST 2026
