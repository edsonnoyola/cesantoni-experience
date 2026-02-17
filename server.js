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
app.get('/api/health', async (req, res) => res.json({ version: 'v9.3.0', commit: 'bot-cleanup-scoring-og' }));

// Ensure directories exist
['uploads', 'public/videos', 'public/landings'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// Veo 3.1 config - usando API directa
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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

// Haversine distance (km) between two lat/lng points
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get('/api/stores/nearest', async (req, res) => {
  try {
    const { lat, lng, limit } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const max = Math.min(parseInt(limit) || 5, 20);

    const stores = await query(`
      SELECT s.*, d.name as distributor_name
      FROM stores s JOIN distributors d ON s.distributor_id = d.id
      WHERE s.active = 1 AND s.lat IS NOT NULL AND s.lng IS NOT NULL
    `);

    const withDist = stores.map(s => ({
      ...s,
      distance_km: Math.round(haversine(userLat, userLng, s.lat, s.lng) * 10) / 10
    })).sort((a, b) => a.distance_km - b.distance_km).slice(0, max);

    res.json(withDist);
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

// Landing page with server-side OG meta tags for WhatsApp/social previews
app.get('/p/:sku', async (req, res) => {
  try {
    const product = await queryOne(
      'SELECT name, description, image_url, category, format, base_price, sku, slug FROM products WHERE sku ILIKE ? OR slug ILIKE ?',
      [req.params.sku, req.params.sku]
    );
    if (!product) return res.sendFile(path.join(__dirname, 'public', 'landing.html'));

    let html = fs.readFileSync(path.join(__dirname, 'public', 'landing.html'), 'utf8');
    const title = `${product.name} | Cesantoni Premium`;
    const desc = (product.description || `Piso ${product.category || 'premium'} ${product.format || ''} de alta calidad`).substring(0, 160);
    const img = product.image_url || '';
    const url = `${BASE_URL}/p/${product.sku || product.slug}`;

    html = html.replace('<title id="page-title">Cesantoni Premium</title>',
      `<title id="page-title">${title}</title>`);
    html = html.replace('<meta name="description" id="meta-description" content="Descubre pisos premium de la más alta calidad.">',
      `<meta name="description" id="meta-description" content="${desc.replace(/"/g, '&quot;')}">`);
    html = html.replace('<meta property="og:title" id="og-title" content="Cesantoni Premium">',
      `<meta property="og:title" id="og-title" content="${title.replace(/"/g, '&quot;')}">`);
    html = html.replace('<meta property="og:image" id="og-image" content="">',
      `<meta property="og:image" id="og-image" content="${img}">`);
    html = html.replace('</head>',
      `<meta property="og:description" content="${desc.replace(/"/g, '&quot;')}">
      <meta property="og:url" content="${url}">
      <meta property="og:type" content="product">
      <meta property="og:site_name" content="Cesantoni Porcelanato Premium">
      ${product.base_price ? `<meta property="product:price:amount" content="${product.base_price}"><meta property="product:price:currency" content="MXN">` : ''}
      </head>`);

    res.send(html);
  } catch (err) {
    console.error('OG landing error:', err.message);
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
  }
});

app.get('/landing/:slug', async (req, res) => {
  res.redirect(301, `/p/${req.params.slug}`);
});

// Public quote page
app.get('/cotizacion/:folio', async (req, res) => {
  try {
    const folio = req.params.folio.toUpperCase();
    const quote = await queryOne('SELECT * FROM quotes WHERE folio = $1', [folio]);
    if (!quote) return res.status(404).send('<h1>Cotizacion no encontrada</h1>');

    const items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order ASC', [quote.id]);

    const validUntil = quote.valid_until
      ? new Date(quote.valid_until).toLocaleDateString('es-MX', {day:'numeric',month:'long',year:'numeric'})
      : new Date(new Date(quote.created_at).getTime() + 15*24*60*60*1000).toLocaleDateString('es-MX', {day:'numeric',month:'long',year:'numeric'});

    const createdDate = new Date(quote.created_at).toLocaleDateString('es-MX', {day:'numeric',month:'long',year:'numeric'});

    const itemsHtml = items.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${item.product_name}</strong></td>
        <td>${item.m2_requested || '-'} m&sup2;</td>
        <td>${item.m2_with_merma || '-'} m&sup2;</td>
        <td>${item.boxes || '-'}</td>
        <td>${item.total_m2 || '-'} m&sup2;</td>
        <td>${item.price_per_m2 ? '$' + Math.round(item.price_per_m2).toLocaleString('es-MX') + '/m&sup2;' : '-'}</td>
        <td><strong>${item.subtotal ? '$' + Math.round(item.subtotal).toLocaleString('es-MX') : '-'}</strong></td>
      </tr>
    `).join('');

    const totalM2 = items.reduce((s, i) => s + (parseFloat(i.total_m2) || 0), 0);

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cotizacion ${folio} - Cesantoni</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans 3', sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #111; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #C9A962; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-family: 'Playfair Display', serif; font-size: 1.8rem; font-weight: 700; color: #111; letter-spacing: 2px; }
    .brand img { height: 50px; display: block; }
    .folio-box { text-align: right; }
    .folio { font-family: 'Playfair Display', serif; font-size: 1.3rem; color: #C9A962; font-weight: 600; }
    .folio-date { font-size: 0.85rem; color: #666; margin-top: 4px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 24px; font-size: 0.9rem; padding: 16px; background: #fafaf8; border-radius: 8px; }
    .meta-label { color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; margin: 24px 0; }
    th { background: #111118; color: white; padding: 10px 8px; text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 0.85rem; }
    tr:nth-child(even) { background: #fafaf8; }
    .total-row { background: #f5eed6 !important; }
    .total-row td { font-size: 1rem; font-weight: 600; border-top: 2px solid #C9A962; }
    .notes { margin-top: 24px; padding: 16px; background: #fafaf8; border-radius: 8px; font-size: 0.8rem; color: #666; line-height: 1.6; }
    .print-btn { display: inline-block; background: #C9A962; color: white; border: none; padding: 12px 28px; border-radius: 6px; cursor: pointer; font-size: 1rem; font-family: 'Source Sans 3', sans-serif; margin: 24px 0; text-decoration: none; }
    .print-btn:hover { background: #A68B4B; }
    .wa-btn { display: inline-block; background: #25D366; color: white; border: none; padding: 12px 28px; border-radius: 6px; cursor: pointer; font-size: 1rem; font-family: 'Source Sans 3', sans-serif; margin: 24px 8px; text-decoration: none; }
    .wa-btn:hover { background: #1DA851; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 2px solid #C9A962; text-align: center; font-size: 0.8rem; color: #888; }
    .footer strong { color: #111; font-family: 'Playfair Display', serif; letter-spacing: 1px; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
    @media (max-width: 600px) {
      .meta { grid-template-columns: 1fr; }
      table { font-size: 0.75rem; }
      th, td { padding: 6px 4px; }
      .header { flex-direction: column; gap: 12px; text-align: center; }
      .folio-box { text-align: center; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img src="/images/logo-cesantoni.png" alt="CESANTONI" onerror="this.outerHTML='<span>CESANTONI</span>'">
    </div>
    <div class="folio-box">
      <div class="folio">${folio}</div>
      <div class="folio-date">${createdDate}</div>
    </div>
  </div>
  <div class="meta">
    <div><div class="meta-label">Cliente</div>${quote.customer_name || 'Cliente'}</div>
    <div><div class="meta-label">Tienda</div>${quote.store_name || 'Cesantoni'}</div>
    <div><div class="meta-label">Telefono</div>${quote.customer_phone || '-'}</div>
    <div><div class="meta-label">Vigencia</div>${validUntil}</div>
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Producto</th><th>Area</th><th>+Merma 10%</th><th>Cajas</th><th>m&sup2; reales</th><th>Precio/m&sup2;</th><th>Subtotal</th></tr>
    </thead>
    <tbody>
      ${itemsHtml}
      <tr class="total-row">
        <td colspan="5" style="text-align:right">TOTAL</td>
        <td>${totalM2.toFixed(1)} m&sup2;</td>
        <td></td>
        <td>$${quote.grand_total ? Math.round(quote.grand_total).toLocaleString('es-MX') : '-'} MXN</td>
      </tr>
    </tbody>
  </table>
  <div class="notes">
    <strong>Notas:</strong><br>
    &bull; Precios sujetos a cambio sin previo aviso<br>
    &bull; Vigencia: 15 dias a partir de la fecha de emision<br>
    &bull; Precios no incluyen instalacion ni envio<br>
    &bull; Se incluye 10% adicional por merma (cortes y desperdicios)
  </div>
  <div class="no-print" style="text-align:center">
    <button class="print-btn" onclick="window.print()">Imprimir / Descargar PDF</button>
    <a class="wa-btn" href="https://wa.me/5215651747912?text=${encodeURIComponent('Hola, tengo la cotizacion ' + folio + ' y me gustaria continuar')}" target="_blank">Contactar por WhatsApp</a>
  </div>
  <div class="footer">
    <strong>CESANTONI</strong><br>Pisos &amp; Revestimientos Premium | cesantoni.com.mx
  </div>
</body>
</html>`);
  } catch (e) {
    console.error('Quote page error:', e.message);
    res.status(500).send('<h1>Error al cargar la cotizacion</h1>');
  }
});

// Public store locator page
app.get('/tiendas', async (req, res) => {
  try {
    const stores = await query(`
      SELECT s.id, s.name, s.state, s.city, s.address, s.lat, s.lng, s.whatsapp, s.phone,
             s.promo_text, d.name as distributor_name
      FROM stores s JOIN distributors d ON s.distributor_id = d.id
      WHERE s.active = 1 AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      ORDER BY s.state, s.name
    `);
    const states = [...new Set(stores.map(s => s.state))].sort();

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Encuentra tu Tienda - Cesantoni</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Sans+3:wght@300;400;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Source Sans 3', sans-serif; background: #111118; color: #fff; height: 100vh; display: flex; flex-direction: column; }

  .header { background: #111118; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #C9A962; z-index: 1000; }
  .header h1 { font-family: 'Playfair Display', serif; font-size: 1.3rem; color: #C9A962; }
  .header .logo { font-family: 'Playfair Display', serif; font-size: 0.9rem; letter-spacing: 3px; color: #C9A962; border: 1px solid #C9A962; padding: 4px 12px; }
  .header .count { font-size: 0.85rem; color: #aaa; }

  .main { display: flex; flex: 1; overflow: hidden; }
  #map { flex: 1; z-index: 1; }

  .sidebar { width: 360px; background: #1a1a24; overflow-y: auto; display: flex; flex-direction: column; z-index: 2; }
  .sidebar-header { padding: 16px; border-bottom: 1px solid #333; }
  .sidebar-header select { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #444; background: #222; color: #fff; font-size: 0.95rem; }
  .btn-locate { width: 100%; margin-top: 10px; padding: 12px; border: none; border-radius: 8px; background: #C9A962; color: #111; font-weight: 600; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .btn-locate:hover { background: #b8953d; }

  .store-list { flex: 1; overflow-y: auto; }
  .store-card { padding: 14px 16px; border-bottom: 1px solid #2a2a34; cursor: pointer; transition: background 0.2s; }
  .store-card:hover { background: #252530; }
  .store-card.active { background: #2a2a3a; border-left: 3px solid #C9A962; }
  .store-card h3 { font-size: 0.95rem; color: #fff; margin-bottom: 4px; }
  .store-card .dist { font-size: 0.8rem; color: #C9A962; margin-bottom: 4px; }
  .store-card .addr { font-size: 0.8rem; color: #999; line-height: 1.4; }
  .store-card .distance { font-size: 0.85rem; color: #C9A962; font-weight: 600; margin-top: 6px; }
  .store-card .actions { margin-top: 8px; display: flex; gap: 8px; }
  .store-card .actions a { font-size: 0.8rem; color: #C9A962; text-decoration: none; padding: 4px 10px; border: 1px solid #C9A962; border-radius: 4px; }
  .store-card .actions a:hover { background: #C9A962; color: #111; }

  .no-results { padding: 40px 16px; text-align: center; color: #666; }

  @media (max-width: 768px) {
    .main { flex-direction: column-reverse; }
    .sidebar { width: 100%; max-height: 45vh; }
    #map { min-height: 55vh; }
    .header h1 { font-size: 1rem; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="logo">CESANTONI</div>
  <h1>Encuentra tu Tienda</h1>
  <div class="count">${stores.length} tiendas</div>
</div>
<div class="main">
  <div class="sidebar">
    <div class="sidebar-header">
      <select id="stateFilter" onchange="filterByState()">
        <option value="">Todos los estados</option>
        ${states.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <button class="btn-locate" onclick="locateMe()">📍 Usar mi ubicacion</button>
    </div>
    <div class="store-list" id="storeList"></div>
  </div>
  <div id="map"></div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const allStores = ${JSON.stringify(stores.map(s => ({
  id: s.id, name: s.name, state: s.state, city: s.city || '',
  address: s.address || '', lat: s.lat, lng: s.lng,
  whatsapp: s.whatsapp || '', phone: s.phone || '',
  distributor: s.distributor_name || '', promo: s.promo_text || ''
})))};

const map = L.map('map').setView([23.6345, -102.5528], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap', maxZoom: 18
}).addTo(map);

const goldIcon = L.divIcon({
  html: '<div style="background:#C9A962;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8], className: ''
});
const activeIcon = L.divIcon({
  html: '<div style="background:#fff;width:16px;height:16px;border-radius:50%;border:3px solid #C9A962;box-shadow:0 2px 8px rgba(201,169,98,0.6)"></div>',
  iconSize: [22, 22], iconAnchor: [11, 11], className: ''
});

let markers = [];
let userMarker = null;
let userLat = null, userLng = null;
let activeStoreId = null;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderStores(stores) {
  const list = document.getElementById('storeList');
  if (stores.length === 0) { list.innerHTML = '<div class="no-results">No se encontraron tiendas</div>'; return; }

  list.innerHTML = stores.map(s => {
    const dist = s._dist != null ? '<div class="distance">📍 ' + s._dist.toFixed(1) + ' km</div>' : '';
    const wa = s.whatsapp ? '<a href="https://wa.me/' + s.whatsapp.replace(/\\D/g,'') + '" target="_blank">💬 WhatsApp</a>' : '';
    const ph = s.phone ? '<a href="tel:' + s.phone + '">📞 Llamar</a>' : '';
    return '<div class="store-card' + (s.id === activeStoreId ? ' active' : '') + '" onclick="focusStore(' + s.id + ',' + s.lat + ',' + s.lng + ')">' +
      '<h3>' + s.name + '</h3>' +
      '<div class="dist">' + s.distributor + (s.promo ? ' · ' + s.promo : '') + '</div>' +
      '<div class="addr">' + s.address + '<br>' + [s.city, s.state].filter(Boolean).join(', ') + '</div>' +
      dist +
      '<div class="actions">' + wa + ph + '</div></div>';
  }).join('');
}

function addMarkers(stores) {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  stores.forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: goldIcon })
      .bindPopup('<b>' + s.name + '</b><br>' + s.distributor + '<br><small>' + s.address + '</small>' +
        (s.whatsapp ? '<br><a href="https://wa.me/' + s.whatsapp.replace(/\\D/g,'') + '" target="_blank">💬 WhatsApp</a>' : ''))
      .addTo(map);
    m._storeId = s.id;
    markers.push(m);
  });
}

function focusStore(id, lat, lng) {
  activeStoreId = id;
  map.setView([lat, lng], 15);
  markers.forEach(m => { m.setIcon(m._storeId === id ? activeIcon : goldIcon); if (m._storeId === id) m.openPopup(); });
  document.querySelectorAll('.store-card').forEach((c, i) => {
    const stores = getFilteredStores();
    c.classList.toggle('active', stores[i] && stores[i].id === id);
  });
}

function getFilteredStores() {
  const state = document.getElementById('stateFilter').value;
  let filtered = state ? allStores.filter(s => s.state === state) : [...allStores];
  if (userLat != null) {
    filtered.forEach(s => s._dist = haversine(userLat, userLng, s.lat, s.lng));
    filtered.sort((a, b) => a._dist - b._dist);
  }
  return filtered;
}

function filterByState() {
  const stores = getFilteredStores();
  renderStores(stores);
  addMarkers(stores);
  if (stores.length > 0 && !userLat) {
    const bounds = L.latLngBounds(stores.map(s => [s.lat, s.lng]));
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function locateMe() {
  if (!navigator.geolocation) { alert('Tu navegador no soporta geolocalizacion'); return; }
  const btn = document.querySelector('.btn-locate');
  btn.textContent = '⏳ Buscando...';
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([userLat, userLng], {
      icon: L.divIcon({ html: '<div style="background:#4285f4;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 6px rgba(66,133,244,0.6)"></div>', iconSize: [20,20], iconAnchor: [10,10], className: '' })
    }).addTo(map).bindPopup('Tu ubicacion').openPopup();

    const stores = getFilteredStores();
    renderStores(stores);
    addMarkers(stores);
    map.setView([userLat, userLng], 11);
    btn.textContent = '📍 Ubicacion activada';
  }, err => {
    btn.textContent = '📍 Usar mi ubicacion';
    alert('No se pudo obtener tu ubicacion. Verifica los permisos.');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

// Initial render
addMarkers(allStores);
renderStores(allStores);
</script>
</body>
</html>`);
  } catch (e) {
    console.error('Store locator error:', e.message);
    res.status(500).send('<h1>Error al cargar el localizador</h1>');
  }
});

// =====================================================
// PUBLIC CATALOG PAGE
// =====================================================
app.get('/catalogo', async (req, res) => {
  try {
    const products = await query(`
      SELECT id, sku, name, category, subcategory, format, finish, type,
             uses, base_price, image_url, gallery, slug, description, pei,
             sqm_per_box, pieces_per_box, official_url, usage, resistance
      FROM products WHERE active = 1 ORDER BY category, name
    `);
    const categories = [...new Set(products.filter(p => p.category).map(p => p.category))].sort();
    const finishes = [...new Set(products.filter(p => p.finish).map(p => p.finish))].sort();
    const formats = [...new Set(products.filter(p => p.format).map(p => p.format))].sort();

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Catálogo de Pisos Premium - Cesantoni</title>
<meta name="description" content="Explora más de ${products.length} pisos premium: mármol, madera, piedra y más. Porcelanato de la más alta calidad.">
<meta property="og:title" content="Catálogo de Pisos Premium - Cesantoni">
<meta property="og:description" content="Explora más de ${products.length} pisos premium: mármol, madera, piedra y más.">
<meta property="og:url" content="${BASE_URL}/catalogo">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cesantoni Porcelanato Premium">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Source+Sans+3:wght@300;400;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Source Sans 3', sans-serif; background: #111118; color: #fff; min-height: 100vh; }

  .header { background: #111118; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #C9A962; position: sticky; top: 0; z-index: 100; }
  .header h1 { font-family: 'Playfair Display', serif; font-size: 1.4rem; color: #C9A962; }
  .header .logo { font-family: 'Playfair Display', serif; font-size: 0.85rem; letter-spacing: 3px; color: #C9A962; border: 1px solid #C9A962; padding: 4px 12px; }
  .header .count { font-size: 0.85rem; color: #999; }

  .filters { padding: 16px 24px; border-bottom: 1px solid #222; background: #16161e; position: sticky; top: 58px; z-index: 99; }
  .cat-pills { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; }
  .cat-pills::-webkit-scrollbar { display: none; }
  .pill { padding: 6px 16px; border-radius: 20px; border: 1px solid #444; background: transparent; color: #ccc; font-size: 0.85rem; cursor: pointer; white-space: nowrap; transition: all 0.2s; }
  .pill:hover { border-color: #C9A962; color: #C9A962; }
  .pill.active { background: #C9A962; color: #111; border-color: #C9A962; font-weight: 600; }

  .filter-row { display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .filter-row select, .filter-row input { padding: 8px 12px; border-radius: 8px; border: 1px solid #444; background: #222; color: #fff; font-size: 0.85rem; min-width: 140px; }
  .filter-row .search-box { flex: 1; min-width: 200px; }
  .result-count { font-size: 0.85rem; color: #888; margin-left: auto; white-space: nowrap; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; padding: 24px; max-width: 1400px; margin: 0 auto; }

  .card { background: #1a1a24; border-radius: 12px; overflow: hidden; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; border: 1px solid #2a2a34; }
  .card:hover { transform: translateY(-4px); box-shadow: 0 8px 30px rgba(201,169,98,0.15); border-color: #C9A962; }
  .card-img { width: 100%; height: 200px; object-fit: cover; background: #222; }
  .card-body { padding: 14px 16px; }
  .card-cat { font-size: 0.75rem; color: #C9A962; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .card-name { font-family: 'Playfair Display', serif; font-size: 1.05rem; margin-bottom: 6px; color: #fff; }
  .card-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .badge { font-size: 0.7rem; padding: 3px 8px; border-radius: 4px; background: #2a2a34; color: #bbb; }
  .badge.finish { background: #C9A96220; color: #C9A962; }
  .card-price { font-size: 1.1rem; font-weight: 700; color: #C9A962; }
  .card-price span { font-size: 0.8rem; font-weight: 400; color: #888; }

  /* Detail modal */
  .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); z-index: 200; overflow-y: auto; padding: 40px 20px; }
  .modal-overlay.open { display: flex; justify-content: center; align-items: flex-start; }
  .modal { background: #1a1a24; border-radius: 16px; max-width: 800px; width: 100%; border: 1px solid #333; }
  .modal-close { position: absolute; top: 16px; right: 20px; font-size: 2rem; color: #888; cursor: pointer; background: none; border: none; z-index: 10; }
  .modal-close:hover { color: #fff; }
  .modal-img { width: 100%; height: 320px; object-fit: cover; border-radius: 16px 16px 0 0; }
  .modal-gallery { display: flex; gap: 8px; padding: 12px 24px; overflow-x: auto; }
  .modal-gallery img { width: 80px; height: 60px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 2px solid transparent; transition: border 0.2s; }
  .modal-gallery img:hover, .modal-gallery img.active { border-color: #C9A962; }
  .modal-body { padding: 20px 24px 24px; }
  .modal-body h2 { font-family: 'Playfair Display', serif; font-size: 1.5rem; color: #C9A962; margin-bottom: 4px; }
  .modal-body .sku { font-size: 0.85rem; color: #888; margin-bottom: 16px; }
  .modal-specs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
  .spec { padding: 10px 14px; background: #222; border-radius: 8px; }
  .spec-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .spec-val { font-size: 0.95rem; color: #fff; font-weight: 600; margin-top: 2px; }
  .modal-desc { font-size: 0.9rem; color: #bbb; line-height: 1.6; margin-bottom: 20px; }
  .modal-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .btn-wa { display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; background: #25D366; color: #fff; border: none; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.2s; }
  .btn-wa:hover { background: #1da851; }
  .btn-site { display: inline-flex; align-items: center; gap: 6px; padding: 14px 24px; background: transparent; color: #C9A962; border: 1px solid #C9A962; border-radius: 10px; font-size: 0.95rem; cursor: pointer; text-decoration: none; transition: all 0.2s; }
  .btn-site:hover { background: #C9A962; color: #111; }

  .no-products { text-align: center; padding: 80px 20px; color: #666; }
  .no-products h2 { font-family: 'Playfair Display', serif; color: #444; margin-bottom: 8px; }

  @media (max-width: 768px) {
    .grid { grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 12px; }
    .card-img { height: 150px; }
    .header h1 { font-size: 1.1rem; }
    .modal-img { height: 220px; }
    .modal-specs { grid-template-columns: 1fr; }
    .filters { padding: 12px; }
    .filter-row { flex-direction: column; }
    .filter-row select, .filter-row input { width: 100%; }
  }
  @media (max-width: 480px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="header">
  <div style="display:flex;align-items:center;gap:16px">
    <div class="logo">CESANTONI</div>
    <h1>Catálogo de Pisos</h1>
  </div>
  <span class="count">${products.length} productos</span>
</div>

<div class="filters">
  <div class="cat-pills" id="catPills">
    <button class="pill active" data-cat="all">Todos</button>
    ${categories.map(c => `<button class="pill" data-cat="${c}">${c}</button>`).join('')}
  </div>
  <div class="filter-row">
    <input type="text" id="searchBox" class="search-box" placeholder="Buscar por nombre, SKU..." />
    <select id="filterFinish"><option value="">Acabado</option>${finishes.map(f => `<option value="${f}">${f}</option>`).join('')}</select>
    <select id="filterFormat"><option value="">Formato</option>${formats.map(f => `<option value="${f}">${f}</option>`).join('')}</select>
    <select id="filterPrice">
      <option value="">Precio</option>
      <option value="0-300">Hasta $300/m²</option>
      <option value="300-500">$300 - $500/m²</option>
      <option value="500-800">$500 - $800/m²</option>
      <option value="800-99999">$800+ /m²</option>
    </select>
    <span class="result-count" id="resultCount"></span>
  </div>
</div>

<div class="grid" id="productGrid"></div>

<div class="no-products" id="noProducts" style="display:none">
  <h2>Sin resultados</h2>
  <p>Intenta con otros filtros o busca por nombre</p>
</div>

<div class="modal-overlay" id="modal">
  <div class="modal" style="position:relative">
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <img class="modal-img" id="modalImg" src="" alt="" />
    <div class="modal-gallery" id="modalGallery"></div>
    <div class="modal-body">
      <h2 id="modalName"></h2>
      <p class="sku" id="modalSku"></p>
      <div class="modal-specs" id="modalSpecs"></div>
      <p class="modal-desc" id="modalDesc"></p>
      <div class="modal-actions" id="modalActions"></div>
    </div>
  </div>
</div>

<script>
const allProducts = ${JSON.stringify(products.map(p => ({
  id: p.id, sku: p.sku, name: p.name, category: p.category || '',
  subcategory: p.subcategory || '', format: p.format || '', finish: p.finish || '',
  type: p.type || '', uses: p.uses || '', base_price: p.base_price || 0,
  image_url: p.image_url || '', gallery: p.gallery || '', slug: p.slug || '',
  description: p.description || '', pei: p.pei || 0,
  sqm_per_box: p.sqm_per_box || 0, pieces_per_box: p.pieces_per_box || 0,
  official_url: p.official_url || '', usage: p.usage || '', resistance: p.resistance || ''
})))};

let currentCat = 'all';
let currentSearch = '';
let currentFinish = '';
let currentFormat = '';
let currentPrice = '';

function filterProducts() {
  let filtered = allProducts;
  if (currentCat !== 'all') filtered = filtered.filter(p => p.category === currentCat);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.subcategory.toLowerCase().includes(q));
  }
  if (currentFinish) filtered = filtered.filter(p => p.finish === currentFinish);
  if (currentFormat) filtered = filtered.filter(p => p.format === currentFormat);
  if (currentPrice) {
    const [min, max] = currentPrice.split('-').map(Number);
    filtered = filtered.filter(p => p.base_price >= min && p.base_price <= max);
  }
  return filtered;
}

function renderGrid() {
  const products = filterProducts();
  const grid = document.getElementById('productGrid');
  const noP = document.getElementById('noProducts');
  document.getElementById('resultCount').textContent = products.length + ' de ' + allProducts.length;

  if (products.length === 0) {
    grid.innerHTML = '';
    noP.style.display = 'block';
    return;
  }
  noP.style.display = 'none';

  grid.innerHTML = products.map(p => {
    const img = p.image_url || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" fill="%23222"><rect width="300" height="200"/><text x="150" y="100" text-anchor="middle" fill="%23555" font-size="14">Sin imagen</text></svg>');
    return '<div class="card" onclick="openModal(' + p.id + ')">' +
      '<img class="card-img" src="' + img + '" alt="' + p.name + '" loading="lazy" onerror="this.src=\\'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" fill="%23222"><rect width="300" height="200"/><text x="150" y="100" text-anchor="middle" fill="%23555" font-size="14">Sin imagen</text></svg>') + '\\'"/>' +
      '<div class="card-body">' +
        '<div class="card-cat">' + p.category + (p.subcategory ? ' · ' + p.subcategory : '') + '</div>' +
        '<div class="card-name">' + p.name + '</div>' +
        '<div class="card-meta">' +
          (p.format ? '<span class="badge">' + p.format + '</span>' : '') +
          (p.finish ? '<span class="badge finish">' + p.finish + '</span>' : '') +
          (p.pei ? '<span class="badge">PEI ' + p.pei + '</span>' : '') +
        '</div>' +
        (p.base_price ? '<div class="card-price">$' + Math.round(p.base_price).toLocaleString() + ' <span>/m²</span></div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function openModal(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;

  document.getElementById('modalImg').src = p.image_url || '';
  document.getElementById('modalName').textContent = p.name;
  document.getElementById('modalSku').textContent = 'SKU: ' + p.sku + (p.type ? ' · ' + p.type : '');

  // Gallery
  const galleryEl = document.getElementById('modalGallery');
  let images = [];
  if (p.gallery) {
    try { images = JSON.parse(p.gallery); } catch { images = []; }
  }
  if (p.image_url) images = [p.image_url, ...images.filter(i => i !== p.image_url)];
  galleryEl.innerHTML = images.slice(0, 8).map((img, i) =>
    '<img src="' + img + '" class="' + (i === 0 ? 'active' : '') + '" onclick="document.getElementById(\\'modalImg\\').src=this.src; this.parentElement.querySelectorAll(\\'img\\').forEach(x=>x.classList.remove(\\'active\\')); this.classList.add(\\'active\\')" />'
  ).join('');

  // Specs
  const specs = [];
  if (p.format) specs.push({ l: 'Formato', v: p.format });
  if (p.finish) specs.push({ l: 'Acabado', v: p.finish });
  if (p.category) specs.push({ l: 'Categoría', v: p.category + (p.subcategory ? ' - ' + p.subcategory : '') });
  if (p.pei) specs.push({ l: 'PEI', v: p.pei + (p.pei >= 4 ? ' (Alto tráfico)' : '') });
  if (p.usage) specs.push({ l: 'Uso', v: p.usage });
  if (p.resistance) specs.push({ l: 'Resistencia', v: p.resistance });
  if (p.sqm_per_box) specs.push({ l: 'm²/caja', v: p.sqm_per_box.toFixed(2) + ' m²' });
  if (p.pieces_per_box) specs.push({ l: 'Piezas/caja', v: p.pieces_per_box });
  if (p.base_price) specs.push({ l: 'Precio', v: '$' + Math.round(p.base_price).toLocaleString() + ' /m²' });
  if (p.uses) specs.push({ l: 'Aplicaciones', v: p.uses });

  document.getElementById('modalSpecs').innerHTML = specs.map(s =>
    '<div class="spec"><div class="spec-label">' + s.l + '</div><div class="spec-val">' + s.v + '</div></div>'
  ).join('');

  document.getElementById('modalDesc').textContent = p.description || '';

  // Actions
  const waMsg = encodeURIComponent('Hola, me interesa el piso ' + p.name + (p.sku ? ' (SKU: ' + p.sku + ')' : '') + '. ¿Me pueden dar más información?');
  let actions = '<a class="btn-wa" href="https://wa.me/5215651747912?text=' + waMsg + '" target="_blank">&#x1F4AC; Cotizar por WhatsApp</a>';
  if (p.official_url) {
    actions += '<a class="btn-site" href="' + p.official_url + '" target="_blank">Ver en cesantoni.com.mx &#x2197;</a>';
  }
  document.getElementById('modalActions').innerHTML = actions;

  document.getElementById('modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.body.style.overflow = '';
}

// Event listeners
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCat = btn.dataset.cat;
    renderGrid();
  });
});

document.getElementById('searchBox').addEventListener('input', e => { currentSearch = e.target.value; renderGrid(); });
document.getElementById('filterFinish').addEventListener('change', e => { currentFinish = e.target.value; renderGrid(); });
document.getElementById('filterFormat').addEventListener('change', e => { currentFormat = e.target.value; renderGrid(); });
document.getElementById('filterPrice').addEventListener('change', e => { currentPrice = e.target.value; renderGrid(); });

// Initial render
renderGrid();
</script>
</body>
</html>`);
  } catch (e) {
    console.error('Catalog error:', e.message);
    res.status(500).send('<h1>Error al cargar el catálogo</h1>');
  }
});

// Public comparison page
app.get('/comparar/:ids', async (req, res) => {
  try {
    const idList = req.params.ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
    if (idList.length < 2) return res.status(400).send('<h1>Se necesitan al menos 2 productos</h1>');

    const products = [];
    for (const ref of idList) {
      const p = await queryOne('SELECT * FROM products WHERE sku = $1 OR slug = $1 OR id::text = $1', [ref]);
      if (p) products.push(p);
    }
    if (products.length < 2) return res.status(404).send('<h1>Productos no encontrados</h1>');

    const cols = products.length;
    const specs = [
      { label: 'Precio/m²', fn: p => p.base_price ? `$${p.base_price}` : '-' },
      { label: 'Formato', fn: p => p.format || '-' },
      { label: 'Acabado', fn: p => p.finish || '-' },
      { label: 'PEI', fn: p => p.pei ? `PEI ${p.pei}` : '-' },
      { label: 'm²/Caja', fn: p => p.sqm_per_box ? `${p.sqm_per_box} m²` : '-' },
      { label: 'Uso', fn: p => p.usage || '-' },
      { label: 'Tipo', fn: p => p.type || '-' },
      { label: 'Categoría', fn: p => p.category || '-' }
    ];

    const headerCells = products.map(p => `
      <div class="cp-cell cp-header-cell">
        <img src="${p.image_url || '/images/placeholder.jpg'}" alt="${p.name}" onerror="this.src='/images/placeholder.jpg'">
        <div class="cp-name">${p.name}</div>
        <div class="cp-price">$${p.base_price || '?'}/m²</div>
        <div class="cp-cat">${p.category || 'Piso Premium'}</div>
      </div>
    `).join('');

    const specRows = specs.map(s => {
      const cells = products.map(p => {
        const val = s.fn(p);
        const isPrice = s.label.includes('Precio');
        return `<div class="cp-cell${isPrice ? ' cp-highlight' : ''}">${val}</div>`;
      }).join('');
      return `<div class="cp-label">${s.label}</div>${cells}`;
    }).join('');

    const waMsg = encodeURIComponent('Hola, estoy comparando pisos: ' + products.map(p => p.name).join(' vs ') + '. Me interesa cotizar.');

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comparar ${products.map(p => p.name).join(' vs ')} - Cesantoni</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans 3', sans-serif; background: #fafaf8; color: #111; }
    .cp-header { background: #111118; color: white; padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; }
    .cp-brand { font-family: 'Playfair Display', serif; font-size: 1.5rem; font-weight: 700; letter-spacing: 2px; }
    .cp-brand img { height: 40px; }
    .cp-subtitle { color: #C9A962; font-size: 0.85rem; }
    .cp-container { max-width: 900px; margin: 24px auto; padding: 0 16px; }
    .cp-grid { display: grid; grid-template-columns: 120px repeat(${cols}, 1fr); gap: 1px; background: #e0e0e0; border-radius: 12px; overflow: hidden; }
    .cp-label { background: #f5f5f0; padding: 12px 14px; font-weight: 600; font-size: 0.8rem; color: #666; text-transform: uppercase; letter-spacing: 0.3px; display: flex; align-items: center; }
    .cp-cell { background: white; padding: 12px 14px; font-size: 0.9rem; text-align: center; display: flex; align-items: center; justify-content: center; }
    .cp-highlight { font-weight: 700; color: #C9A962; font-size: 1rem; }
    .cp-header-cell { flex-direction: column; padding: 20px 12px; gap: 8px; }
    .cp-header-cell img { width: 100%; max-height: 140px; object-fit: cover; border-radius: 8px; }
    .cp-name { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 1rem; }
    .cp-price { color: #C9A962; font-weight: 700; font-size: 1.1rem; }
    .cp-cat { font-size: 0.75rem; color: #888; }
    .cp-empty { background: #f5f5f0; } /* top-left corner */
    .cp-actions { text-align: center; margin: 32px 0; }
    .cp-btn { display: inline-block; padding: 14px 32px; border-radius: 8px; font-size: 1rem; font-family: 'Source Sans 3', sans-serif; text-decoration: none; font-weight: 600; }
    .cp-btn-wa { background: #25D366; color: white; }
    .cp-btn-wa:hover { background: #1DA851; }
    .cp-footer { text-align: center; padding: 24px; color: #888; font-size: 0.8rem; border-top: 2px solid #C9A962; margin-top: 32px; }
    .cp-footer strong { font-family: 'Playfair Display', serif; color: #111; letter-spacing: 1px; }
    @media (max-width: 600px) {
      .cp-grid { grid-template-columns: 90px repeat(${cols}, 1fr); }
      .cp-cell, .cp-label { padding: 8px 6px; font-size: 0.75rem; }
      .cp-header-cell img { max-height: 80px; }
      .cp-name { font-size: 0.85rem; }
    }
  </style>
</head>
<body>
  <div class="cp-header">
    <div>
      <div class="cp-brand"><img src="/images/logo-cesantoni.png" alt="CESANTONI" onerror="this.outerHTML='<span>CESANTONI</span>'"></div>
      <div class="cp-subtitle">Comparador de Pisos</div>
    </div>
  </div>
  <div class="cp-container">
    <div class="cp-grid">
      <div class="cp-label cp-empty"></div>
      ${headerCells}
      ${specRows}
    </div>
    <div class="cp-actions">
      <a class="cp-btn cp-btn-wa" href="https://wa.me/5215651747912?text=${waMsg}" target="_blank">Cotizar por WhatsApp</a>
    </div>
  </div>
  <div class="cp-footer">
    <strong>CESANTONI</strong><br>Pisos & Revestimientos Premium
  </div>
</body>
</html>`);
  } catch (e) {
    console.error('Compare page error:', e.message);
    res.status(500).send('<h1>Error al cargar comparacion</h1>');
  }
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
    const quotes = await query(`SELECT * FROM quotes ORDER BY created_at DESC LIMIT 100`);
    for (const q of quotes) {
      q.items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order', [q.id]);
    }
    res.json(quotes);
  } catch (err) {
    res.json([]);
  }
});

// Single quote by folio
app.get('/api/quotes/:folio', async (req, res) => {
  try {
    const quote = await queryOne('SELECT * FROM quotes WHERE folio = $1', [req.params.folio.toUpperCase()]);
    if (!quote) return res.status(404).json({ error: 'Not found' });
    quote.items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order', [quote.id]);
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
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
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 1024
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

// Clean Gemini output for WhatsApp: strip markdown, limit emojis, truncate
function cleanBotResponse(text) {
  let r = text;
  // Strip cesantoni.com.mx links (keep our own links)
  r = r.replace(/https?:\/\/(www\.)?cesantoni\.com\.mx\S*/gi, '');
  // Convert **bold** to *bold* (WhatsApp native bold)
  r = r.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  // Strip markdown headers
  r = r.replace(/^#{1,4}\s+/gm, '');
  // Strip horizontal rules and section separators
  r = r.replace(/^[-=─━]{3,}[^─━]*[-─━]*$/gm, '');
  // Strip all bullet/list patterns
  r = r.replace(/^[•●▪▸►]\s+/gm, '');
  r = r.replace(/^[-+*]\s+/gm, '');
  r = r.replace(/^\d+[.)]\s+/gm, '');
  r = r.replace(/^[a-z][.)]\s+/gm, '');
  // Strip backtick code blocks and inline code
  r = r.replace(/```[\s\S]*?```/g, '');
  r = r.replace(/`([^`]+)`/g, '$1');
  // Strip emoji headers like "🏆 TOP RECOMENDACIONES:", "💰 PRECIOS Y DISPONIBILIDAD:", "MI RECOMENDACIÓN #1"
  r = r.replace(/^[\p{Emoji}\p{Emoji_Presentation}\uFE0F]+\s*(TOP|MIS?|MEJORES|RECOMENDACIONES?|OPCIONES|SUGERENCIAS|PRECIOS?|DISPONIBILIDAD|CARACTERÍSTICAS|VENTAJAS|DETALLES)[^\n]*\n?/gmu, '');
  r = r.replace(/^(MI|MIS)\s+(RECOMENDACI[ÓO]N|SELECCI[ÓO]N|TOP|MEJORES)[^\n]*\n?/gmu, '');
  // Limit emojis: keep at most 2
  let emojiCount = 0;
  r = r.replace(/[\p{Emoji_Presentation}]/gu, (match) => {
    emojiCount++;
    return emojiCount <= 2 ? match : '';
  });
  // Clean excessive whitespace
  r = r.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ').trim();
  // Truncate to ~400 chars, cut at last sentence boundary
  if (r.length > 400) {
    const cut = r.substring(0, 400);
    const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    r = lastSentence > 100 ? cut.substring(0, lastSentence + 1) : cut.substring(0, 400).trim();
  }
  return r;
}

// Generate sequential quote folio: COT-26-0001
async function generateQuoteFolio() {
  const year = new Date().getFullYear().toString().slice(-2);
  const lastQuote = await queryOne(
    "SELECT folio FROM quotes WHERE folio LIKE $1 ORDER BY id DESC LIMIT 1",
    [`COT-${year}-%`]
  );
  let nextNum = 1;
  if (lastQuote?.folio) {
    const parts = lastQuote.folio.split('-');
    nextNum = parseInt(parts[2] || '0') + 1;
  }
  return `COT-${year}-${String(nextNum).padStart(4, '0')}`;
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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
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
// Use case map: keyword → product recommendation hints
const USE_CASE_MAP = [
  { pattern: /ba[ñn]o|regadera|ducha|shower/i, filters: { finish: 'MATE' }, tip: 'Acabado mate = antideslizante, ideal para zonas húmedas' },
  { pattern: /cocina|kitchen/i, filters: { finish: 'NATURAL' }, tip: 'Acabado natural = fácil limpieza, resiste manchas' },
  { pattern: /sala|comedor|estancia|living|lobby/i, filters: { finish: 'PULIDO' }, tip: 'Acabado pulido = brillo espejo, elegancia premium' },
  { pattern: /exterior|terraza|patio|alberca|piscina|outdoor/i, filters: { usage: 'EXT' }, tip: 'Porcelánico <0.5% absorción, apto exterior/piscina' },
  { pattern: /madera|wood|parquet/i, filters: { category: 'MADERA' }, tip: 'Porcelanato efecto madera, no se raya ni decolora' },
  { pattern: /m[aá]rmol|marble|calacatta|carrara/i, filters: { category: 'MARMOL' }, tip: 'Porcelanato efecto mármol, sin mantenimiento' },
  { pattern: /piedra|stone|slate|cantera/i, filters: { category: 'PIEDRA' }, tip: 'Efecto piedra natural, resistente a climas extremos' },
  { pattern: /comercial|local|oficina|hotel|restaurante/i, filters: { pei: 4 }, tip: 'PEI 4+ para alto tráfico comercial' },
  { pattern: /gran.*formato|large|grande|120|160|180/i, filters: { format: '120' }, tip: 'Gran formato = menos juntas, aspecto premium' },
  { pattern: /econ[oó]mi|barat|precio bajo|budget/i, filters: { priceMax: 350 }, tip: 'Opciones con excelente relación calidad-precio' },
];

function extractRecommendations(text) {
  const matches = [];
  for (const uc of USE_CASE_MAP) {
    if (uc.pattern.test(text)) matches.push(uc);
  }
  return matches;
}

async function getSmartCatalog(text, useCases) {
  // Build smart SQL based on user intent
  let products = [];

  if (useCases.length > 0) {
    for (const uc of useCases) {
      const f = uc.filters;
      let sql = 'SELECT id, name, slug, sku, category, format, finish, pei, usage, base_price, description, image_url FROM products WHERE active = 1';
      const params = [];
      if (f.category) { sql += ' AND category ILIKE ?'; params.push(`%${f.category}%`); }
      if (f.finish) { sql += ' AND finish ILIKE ?'; params.push(`%${f.finish}%`); }
      if (f.usage) { sql += ' AND usage ILIKE ?'; params.push(`%${f.usage}%`); }
      if (f.pei) { sql += ' AND pei >= ?'; params.push(f.pei); }
      if (f.format) { sql += ' AND format LIKE ?'; params.push(`%${f.format}%`); }
      if (f.priceMax) { sql += ' AND base_price <= ? AND base_price > 0'; params.push(f.priceMax); }
      sql += ' ORDER BY base_price DESC LIMIT 10';
      const found = await query(sql, params);
      products.push(...found);
    }
    // Deduplicate
    const seen = new Set();
    products = products.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }).slice(0, 15);
  }

  // If no use-case match or no results, try keyword search
  if (products.length === 0) {
    const words = text.toLowerCase().match(/[a-záéíóúñü]{3,}/g) || [];
    const searchTerms = words.filter(w => !['hola','quiero','busco','necesito','para','tengo','como','puedo','algo','unos','unas','pisos','piso','que','una','los','las','del','por','con'].includes(w));
    for (const term of searchTerms.slice(0, 3)) {
      const found = await query(
        `SELECT id, name, slug, sku, category, format, finish, pei, usage, base_price, description, image_url FROM products WHERE active = 1 AND (name ILIKE ? OR category ILIKE ? OR finish ILIKE ? OR uses ILIKE ? OR description ILIKE ?) LIMIT 8`,
        [`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`]
      );
      products.push(...found);
    }
    const seen = new Set();
    products = products.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }).slice(0, 15);
  }

  // Final fallback: popular products
  if (products.length === 0) {
    products = await query('SELECT id, name, slug, sku, category, format, finish, pei, usage, base_price, description, image_url FROM products WHERE active = 1 AND base_price > 0 ORDER BY name LIMIT 20');
  }

  return products;
}

async function processWhatsAppMessage(from, text, customerName) {
  // Get conversation history
  const rawHistory = await query(
    'SELECT role, message FROM wa_conversations WHERE phone = ? ORDER BY created_at DESC LIMIT 15',
    [from]
  );
  const history = [...rawHistory].reverse();

  // Save incoming message
  await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

  // Get lead info for context
  const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
  let leadContext = '';
  if (lead) {
    let prods = [];
    try { prods = JSON.parse(lead.products_interested || '[]'); } catch(e) {}

    let storeInfo = null;
    if (lead.store_id) {
      storeInfo = await queryOne('SELECT name, city, state, address, phone, whatsapp FROM stores WHERE id = ?', [lead.store_id]);
    }
    if (!storeInfo && lead.store_name) {
      const slug = lead.store_name.toLowerCase().replace(/\s+/g, '-');
      storeInfo = await queryOne('SELECT name, city, state, address, phone, whatsapp FROM stores WHERE slug = ? OR name ILIKE ? OR name ILIKE ?',
        [slug, lead.store_name, `%${lead.store_name}%`]);
    }

    let productDetails = '';
    if (prods.length > 0) {
      const prodData = (await Promise.all(prods.map(pName => queryOne('SELECT name, slug, sku, base_price, format, finish, type, pei, usage, description, category FROM products WHERE name ILIKE ?', [`%${pName.toLowerCase()}%`])))).filter(Boolean);
      if (prodData.length > 0) {
        productDetails = prodData.map(p => {
          let d = `${p.name} (${p.sku||p.slug}): $${p.base_price||'consultar'}/m², ${p.format||''}, ${p.finish||''}, PEI:${p.pei||'?'}, ${p.usage||''}`;
          if (p.description) d += ` — ${p.description.substring(0, 80)}`;
          return d;
        }).join('\n');
      }
    }

    const storeCity = storeInfo ? `${storeInfo.city || ''}, ${storeInfo.state || ''}`.trim().replace(/^,|,$/g, '') : '';
    const storePhone = storeInfo ? (storeInfo.whatsapp || storeInfo.phone || '') : '';

    leadContext = `\nCONTEXTO DEL LEAD:
- Fuente: ${lead.source === 'landing' ? 'QR en tienda' : lead.source === 'terra_qr' ? 'Terra en tienda' : 'WhatsApp directo'}
- Tienda: ${lead.store_name || 'N/A'}${storeCity ? ' (' + storeCity + ')' : ''}${storePhone ? ' · Tel: ' + storePhone : ''}
- Pisos: ${prods.length > 0 ? prods.join(', ') : 'N/A'}
${productDetails ? '- Detalles:\n' + productDetails : ''}
- ${lead.source === 'landing' || lead.source === 'terra_qr' ? 'ESTÁ EN TIENDA — no digas "pasa a la tienda"' : 'Lead orgánico'}
${storeCity ? '- Ciudad conocida: ' + storeCity + ' — NO preguntes ciudad' : ''}
- Solo falta m² para cotizar. Si da m², calcula: precio × m² × 1.1 (merma)`;
  }

  // Smart catalog: only relevant products
  const useCases = extractRecommendations(text + ' ' + history.filter(h => h.role === 'user').slice(-3).map(h => h.message).join(' '));
  const products = await getSmartCatalog(text, useCases);

  const catalogText = products.map(p =>
    `${p.name}|${p.sku||p.slug}|${p.category||''}|${p.format||''}|${p.finish||''}|PEI:${p.pei||''}|${p.usage||''}|$${p.base_price||'?'}/m²`
  ).join('\n');

  const useCaseTips = useCases.length > 0
    ? '\nSUGERENCIAS PARA ESTE CLIENTE:\n' + useCases.map(u => `- ${u.tip}`).join('\n')
    : '';

  // Conversation summary for long chats (truncate individual messages to avoid prompt bloat)
  const cleanHistory = history.map(h => ({
    role: h.role,
    message: (h.message || '').substring(0, 150).replace(/https?:\/\/\S+/g, '[link]')
  })).filter(h => !h.message.startsWith('[VIEWED_PRODUCT]') && !h.message.startsWith('[FAILED]'));

  let historyText;
  if (cleanHistory.length > 8) {
    const older = cleanHistory.slice(0, -6).map(h => h.message).join(' ').substring(0, 200);
    const recent = cleanHistory.slice(-6).map(h => `${h.role === 'user' ? 'Cliente' : 'Terra'}: ${h.message}`).join('\n');
    historyText = `RESUMEN CONVERSACIÓN ANTERIOR: ${older}...\n\nÚLTIMOS MENSAJES:\n${recent}`;
  } else {
    historyText = cleanHistory.map(h => `${h.role === 'user' ? 'Cliente' : 'Terra'}: ${h.message}`).join('\n');
  }

  const systemPrompt = `Eres Terra, asesora de pisos de Cesantoni por WhatsApp. Amable, experta, directa. Meta: convertir en cotización o visita.

REGLAS ESTRICTAS:
- MÁXIMO 3 oraciones + 1 pregunta. Esto es WhatsApp, NO un email.
- Recomienda MÁXIMO 1 producto. Si quieren más opciones, las das después.
- SIEMPRE en español mexicano. NUNCA en inglés.
- NUNCA uses listas con viñetas (•, -, *). NUNCA uses markdown (**, ##, ---). NUNCA uses separadores. Solo texto plano conversacional.
- NUNCA pongas links de cesantoni.com.mx. Yo agrego los links automáticamente.
- NUNCA pongas encabezados como "MI RECOMENDACIÓN" o "PRECIOS Y DISPONIBILIDAD". Solo habla natural.
- Usa DATOS REALES del producto (formato, acabado, PEI). NO respuestas genéricas.
- PRECIOS: Siempre di "precio estimado" o "precio aproximado". Los precios varían según la tienda y ciudad. Pregunta la ciudad si no la sabes.
- Si no saben qué quieren: "¿Para qué espacio lo necesitas?"
- Si preguntan precio: precio real + ofrece cotización.
- Para cotizar solo necesitas m² y ciudad.
- NUNCA inventes productos. Solo usa los del CATÁLOGO.
- Explica POR QUÉ ese producto es ideal para su necesidad.
- Máximo 1 emoji por mensaje.

CONVERSIÓN:
1. Interés → "¿Cuántos m² necesitas?"
2. Da m² → Calcula: m² × precio × 1.1 = total
3. Sin ciudad → "¿En qué ciudad estás?"
${leadContext}
${useCaseTips}
TÉCNICO: PEI 3=toda la casa, PEI 4=comercios, PEI 5=industrial. Mate=antideslizante baño/cocina. Pulido=brillo espejo sala. Lappato=semi-brillo elegante. Natural=fácil limpieza. <0.5% absorción=exterior/piscina.

Cliente: ${customerName || from}
${historyText ? 'HISTORIAL:\n' + historyText : ''}

CATÁLOGO RELEVANTE (${products.length} productos):
${catalogText}

Responde SOLO el texto del mensaje. Corto, conversacional, sin listas.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Entendido, soy Terra.' }] },
            { role: 'user', parts: [{ text }] }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 }
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
          ]
        })
      }
    );

    const data = await response.json();
    let reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      console.error('WA Gemini empty response:', JSON.stringify({ blockReason: data.promptFeedback?.blockReason, finishReason: data.candidates?.[0]?.finishReason, error: data.error }));
      // Retry with minimal prompt
      try {
        const retryRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `Eres Terra, asesora de pisos Cesantoni. Responde breve en español: ${text}` }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
              ]
            })
          }
        );
        const retryData = await retryRes.json();
        reply = retryData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) console.log('WA Gemini retry succeeded');
      } catch (retryErr) { console.error('WA Gemini retry failed:', retryErr.message); }
    }

    if (!reply) reply = 'Disculpa, tuve un problema. ¿Puedes repetir tu mensaje?';

    // Clean Gemini output for WhatsApp
    reply = cleanBotResponse(reply);

    // Find the best matching product — check reply text AND user's original message
    let matchedProduct = null;
    if (products.length > 0) {
      const replyLower = reply.toLowerCase();
      const textLower = text.toLowerCase();
      // First: match product name mentioned in reply
      matchedProduct = products.find(p => replyLower.includes(p.name.toLowerCase()));
      // Second: match product name mentioned by user
      if (!matchedProduct) {
        matchedProduct = products.find(p => textLower.includes(p.name.toLowerCase()));
      }
      // Third: extract product name from Gemini reply and look up in DB
      if (!matchedProduct) {
        // Gemini often says "El piso NEKK" or "ALABAMA es..." — find capitalized product names
        const nameFromReply = reply.match(/piso\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]{3,})/i)?.[1]
          || reply.match(/\b([A-Z]{3,})\b/)?.[1];
        if (nameFromReply) {
          const directMatch = await queryOne(
            'SELECT id, name, sku, slug, category, format, finish, base_price, image_url FROM products WHERE active = 1 AND (name ILIKE ? OR sku ILIKE ?)',
            [`%${nameFromReply}%`, `%${nameFromReply}%`]
          );
          if (directMatch) matchedProduct = directMatch;
        }
      }
      // Fourth: try individual words from user text against product names
      if (!matchedProduct) {
        const words = text.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).filter(w => w.length >= 3);
        for (const word of words) {
          if (/^(cuanto|cuesta|quiero|para|piso|como|tiene|precio|busco|dame|ver)$/i.test(word)) continue;
          const directMatch = await queryOne(
            'SELECT id, name, sku, slug, category, format, finish, base_price, image_url FROM products WHERE active = 1 AND (name ILIKE ? OR sku ILIKE ?)',
            [`%${word}%`, `%${word}%`]
          );
          if (directMatch) { matchedProduct = directMatch; break; }
        }
      }
      // Last fallback: first product from catalog
      if (!matchedProduct) matchedProduct = products[0];
    }

    if (lead && lead.status === 'new') {
      const allMsgs = history.map(h => h.message).join(' ') + ' ' + text;
      if (/cotiza|metros|m2|m²|cuant.*cuest|precio/i.test(allMsgs)) {
        await run('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['contacted', lead.id]);
      }
    }

    return { reply, product: matchedProduct };
  } catch (err) {
    console.error('WA Gemini error:', err.message);
    return { reply: 'Disculpa, tuve un problema técnico. Intenta de nuevo en un momento.', product: null };
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

    // Deduplicate: Meta sometimes sends the same webhook event twice
    if (!global._processedMsgIds) global._processedMsgIds = new Set();
    if (global._processedMsgIds.has(message.id)) {
      console.log(`⚠️ Duplicate webhook for ${message.id}, skipping`);
      return;
    }
    global._processedMsgIds.add(message.id);
    // Clean old IDs after 5 min to avoid memory leak
    setTimeout(() => global._processedMsgIds.delete(message.id), 300000);

    // Mark as read
    markAsRead(message.id);

    // Track user activity for follow-up system
    await run("UPDATE leads SET last_user_msg_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE phone = ?", [from]);
    // If lead was in follow-up and responds, reset to active engagement
    const followupCheck = await queryOne("SELECT id, status FROM leads WHERE phone = ? AND status = 'follow_up'", [from]);
    if (followupCheck) {
      await run("UPDATE leads SET status = 'new', followup_stage = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [followupCheck.id]);
      console.log(`🔄 Lead ${from} re-engaged, follow-up reset`);
    }

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

          let caption = `*${lProduct.name}*${lProduct.base_price ? ' · ~$' + lProduct.base_price + '/m² (precio estimado)' : ''}\n\n`;
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

      // --- COTIZAR QUEUE: sequential m² collection for multi-product quotes ---
      const m2Number = text.match(/^[\s]*(\d+(?:[.,]\d+)?)\s*(m2|m²|metros?)?\s*$/i);
      if (m2Number) {
        const cotizarQueue = await query(
          "SELECT id, message FROM wa_conversations WHERE phone = ? AND role = 'system' AND message LIKE '[COTIZAR_QUEUE]%' ORDER BY created_at ASC",
          [from]);

        if (cotizarQueue.length > 0) {
          const m2 = parseFloat(m2Number[1].replace(',', '.'));
          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)', [from, 'user', text]);

          // Process current (first in queue)
          const currentEntry = cotizarQueue[0];
          const parts = currentEntry.message.replace('[COTIZAR_QUEUE] ', '').split('|');
          const queueIdx = parseInt(parts[0]);
          const productRef = parts[1];

          const product = await queryOne('SELECT * FROM products WHERE sku = ? OR id::text = ?', [productRef, productRef]);

          if (product && product.sqm_per_box && product.base_price) {
            const m2ConMerma = m2 * 1.10;
            const boxes = Math.ceil(m2ConMerma / product.sqm_per_box);
            const totalM2 = (boxes * product.sqm_per_box).toFixed(2);
            const totalPrice = Math.round(boxes * product.sqm_per_box * product.base_price);

            // Save QUOTE_ITEM
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
              [from, 'assistant', `[QUOTE_ITEM] ${product.name}|${m2}|${m2ConMerma.toFixed(1)}|${boxes}|${totalM2}|${totalPrice}`]);

            // Remove processed entry from queue
            await run('DELETE FROM wa_conversations WHERE id = ?', [currentEntry.id]);

            // Check remaining queue
            const remaining = cotizarQueue.length - 1;

            if (remaining > 0) {
              // Ask for next product
              const nextEntry = cotizarQueue[1];
              const nextParts = nextEntry.message.replace('[COTIZAR_QUEUE] ', '').split('|');
              const nextRef = nextParts[1];
              const nextProduct = await queryOne('SELECT * FROM products WHERE sku = ? OR id::text = ?', [nextRef, nextRef]);
              const nextName = nextProduct?.name || nextRef;

              await sendWhatsApp(from, `✅ *${product.name}*: ${m2} m² → ${boxes} cajas ($${totalPrice.toLocaleString('es-MX')})\n\nSiguiente: *${nextName}*\n¿Cuántos m²?`);
            } else {
              // All products done! Auto-generate quote
              await sendWhatsApp(from, `✅ *${product.name}*: ${m2} m² → ${boxes} cajas ($${totalPrice.toLocaleString('es-MX')})\n\n⏳ Generando tu cotización...`);
              await new Promise(r => setTimeout(r, 800));

              // Trigger quote generation (same logic as enviar_cotizacion)
              await addLeadScore(from, 30, 'cotizacion');
              const quoteItems = await query(
                "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[QUOTE_ITEM]%' ORDER BY created_at ASC",
                [from]);

              if (quoteItems.length > 0) {
                const lead = await queryOne('SELECT * FROM leads WHERE phone = ?', [from]);
                const leadName = lead?.name || contactName || 'Cliente';
                const folio = await generateQuoteFolio();

                let grandTotal = 0;
                let grandM2 = 0;
                const parsedItems = [];

                for (let i = 0; i < quoteItems.length; i++) {
                  const qParts = quoteItems[i].message.replace('[QUOTE_ITEM] ', '').split('|');
                  const [pName, pM2, pM2Merma, pBoxes, pTotalM2, pPrice] = qParts;
                  const price = parseFloat(pPrice) || 0;
                  grandTotal += price;
                  grandM2 += parseFloat(pTotalM2) || 0;

                  const prod = await queryOne('SELECT id, base_price FROM products WHERE name ILIKE ?', [`%${pName.trim()}%`]);
                  parsedItems.push({
                    product_name: pName.trim(), product_id: prod?.id || null,
                    m2_requested: parseFloat(pM2) || 0, m2_with_merma: parseFloat(pM2Merma) || 0,
                    boxes: parseInt(pBoxes) || 0, total_m2: parseFloat(pTotalM2) || 0,
                    price_per_m2: prod?.base_price || null, subtotal: price, sort_order: i
                  });
                }

                const validUntil = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                const quoteResult = await run(
                  `INSERT INTO quotes (folio, customer_name, customer_phone, store_id, store_name, grand_total, items_count, valid_until, lead_id, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent') RETURNING id`,
                  [folio, leadName, from, lead?.store_id || null, lead?.store_name || null, grandTotal, parsedItems.length, validUntil, lead?.id || null]
                );
                const quoteId = quoteResult.rows?.[0]?.id;

                if (quoteId) {
                  for (const item of parsedItems) {
                    await run(
                      `INSERT INTO quote_items (quote_id, product_name, product_id, m2_requested, m2_with_merma, boxes, total_m2, price_per_m2, subtotal, sort_order)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [quoteId, item.product_name, item.product_id, item.m2_requested, item.m2_with_merma, item.boxes, item.total_m2, item.price_per_m2, item.subtotal, item.sort_order]
                    );
                  }
                }

                if (lead?.id) await run("UPDATE leads SET last_quote_folio = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [folio, lead.id]);

                const quoteUrl = `${BASE_URL}/cotizacion/${folio}`;
                let quoteTxt = `📄 *COTIZACIÓN ${folio}*\n`;
                quoteTxt += `👤 ${leadName}\n${'─'.repeat(20)}\n\n`;

                for (let i = 0; i < parsedItems.length; i++) {
                  const item = parsedItems[i];
                  quoteTxt += `*${i + 1}. ${item.product_name}*\n`;
                  quoteTxt += `   ${item.m2_requested} m² → ${item.boxes} cajas`;
                  if (item.subtotal) quoteTxt += ` · $${Math.round(item.subtotal).toLocaleString('es-MX')}`;
                  quoteTxt += `\n`;
                }
                quoteTxt += `\n${'─'.repeat(20)}\n`;
                quoteTxt += `📦 *${grandM2.toFixed(1)} m²* · 💰 *$${Math.round(grandTotal).toLocaleString('es-MX')} MXN*\n`;
                quoteTxt += `\n📋 ${quoteUrl}\n`;
                quoteTxt += `_Vigencia: 15 días_`;

                await sendWhatsApp(from, quoteTxt);

                // Notify store
                const store = lead?.store_id ? await queryOne('SELECT * FROM stores WHERE id = ?', [lead.store_id]) : null;
                if (store?.whatsapp) {
                  await sendWhatsAppTemplate(store.whatsapp, 'lead_nuevo', [
                    leadName, from, store?.name || 'Tienda', `Cotización ${folio}: ${parsedItems.length} pisos, $${Math.round(grandTotal).toLocaleString('es-MX')}`
                  ]);
                }

                await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[QUOTE_ITEM]%'", [from]);
                console.log(`📄 Quote ${folio} created: ${parsedItems.length} items, $${Math.round(grandTotal)}`);

                await new Promise(r => setTimeout(r, 500));
                await sendWhatsAppButtons(from, '¡Tu cotización está lista!', [
                  { id: 'hablar_asesor', title: '👤 Hablar c/asesor' },
                  { id: 'agendar_visita', title: '📅 Agendar visita' },
                  { id: 'ver_mas_catalogo', title: '📋 Cotizar otros' }
                ]);
              }
            }
          } else {
            // Product missing sqm_per_box data
            await run('DELETE FROM wa_conversations WHERE id = ?', [currentEntry.id]);
            const remaining = cotizarQueue.length - 1;
            await sendWhatsApp(from, `⚠️ No tengo datos de empaque para ${product?.name || productRef}. Lo omití.`);
            if (remaining > 0) {
              const nextEntry = cotizarQueue[1];
              const nextParts = nextEntry.message.replace('[COTIZAR_QUEUE] ', '').split('|');
              const nextRef = nextParts[1];
              const nextProduct = await queryOne('SELECT * FROM products WHERE sku = ? OR id::text = ?', [nextRef, nextRef]);
              await sendWhatsApp(from, `Siguiente: *${nextProduct?.name || nextRef}*\n¿Cuántos m²?`);
            }
          }
          return;
        }
      }

      // --- M² Calculator: detect if user is answering the "¿Cuántos m²?" prompt ---
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
            description: `~$${s.base_price || '?'}/m² est. · ${s.format || ''} · ${s.finish || ''}`
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
            await sendWhatsAppImage(from, catProducts[0].image_url, `${catProducts[0].name} — ~$${catProducts[0].base_price || '?'}/m² (precio estimado)`);
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
      if (cleanText.length >= 3 && cleanText.length <= 50 && !/\s{2,}/.test(cleanText)) {
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

          let caption = `*${p.name}*${p.base_price ? ' · ~$' + p.base_price + '/m² (precio estimado)' : ''}\n\n`;
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

      const { reply, product } = await processWhatsAppMessage(from, text, contactName);
      const baseUrl = 'https://cesantoni-experience-za74.onrender.com';

      if (product?.image_url) {
        // Send ONE image with recommendation + product info + landing link as caption
        const slug = product.sku || product.slug;
        const caption = `${reply}\n\n*${product.name}*${product.base_price ? ' · ~$' + product.base_price + '/m² (precio estimado)' : ''}${product.format ? ' · ' + product.format : ''}\n\n${baseUrl}/p/${slug}\n\nVe todo nuestro catálogo: ${baseUrl}/catalogo`;
        await sendWhatsAppImage(from, product.image_url, caption);
      } else {
        await sendWhatsApp(from, reply);
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
            let caption = `*${s.name}* · ~$${s.base_price || '?'}/m² (estimado)\n`;
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

          // 1. Generate folio
          const folio = await generateQuoteFolio();

          // 2. Parse items and calculate totals
          let grandTotal = 0;
          let grandM2 = 0;
          const parsedItems = [];

          for (let i = 0; i < quoteItems.length; i++) {
            const parts = quoteItems[i].message.replace('[QUOTE_ITEM] ', '').split('|');
            const [pName, pM2, pM2Merma, pBoxes, pTotalM2, pPrice] = parts;
            const price = parseFloat(pPrice) || 0;
            grandTotal += price;
            grandM2 += parseFloat(pTotalM2) || 0;

            const product = await queryOne('SELECT id, base_price FROM products WHERE name ILIKE ?', [`%${pName.trim()}%`]);

            parsedItems.push({
              product_name: pName.trim(),
              product_id: product?.id || null,
              m2_requested: parseFloat(pM2) || 0,
              m2_with_merma: parseFloat(pM2Merma) || 0,
              boxes: parseInt(pBoxes) || 0,
              total_m2: parseFloat(pTotalM2) || 0,
              price_per_m2: product?.base_price || null,
              subtotal: price,
              sort_order: i
            });
          }

          // 3. Save quote to DB
          const validUntil = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const quoteResult = await run(
            `INSERT INTO quotes (folio, customer_name, customer_phone, store_id, store_name, grand_total, items_count, valid_until, lead_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent') RETURNING id`,
            [folio, leadName, from, lead?.store_id || null, lead?.store_name || null, grandTotal, parsedItems.length, validUntil, lead?.id || null]
          );
          const quoteId = quoteResult.rows?.[0]?.id;

          // 4. Save quote items
          if (quoteId) {
            for (const item of parsedItems) {
              await run(
                `INSERT INTO quote_items (quote_id, product_name, product_id, m2_requested, m2_with_merma, boxes, total_m2, price_per_m2, subtotal, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [quoteId, item.product_name, item.product_id, item.m2_requested, item.m2_with_merma, item.boxes, item.total_m2, item.price_per_m2, item.subtotal, item.sort_order]
              );
            }
          }

          // 5. Update lead with quote folio
          if (lead?.id) {
            await run("UPDATE leads SET last_quote_folio = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [folio, lead.id]);
          }

          // 6. Build WhatsApp summary with link
          const quoteUrl = `${BASE_URL}/cotizacion/${folio}`;
          let quoteTxt = `📄 *COTIZACIÓN ${folio}*\n`;
          quoteTxt += `👤 ${leadName}\n`;
          quoteTxt += `📅 ${new Date().toLocaleDateString('es-MX')}\n`;
          quoteTxt += `${'─'.repeat(20)}\n\n`;

          for (let i = 0; i < parsedItems.length; i++) {
            const item = parsedItems[i];
            quoteTxt += `*${i + 1}. ${item.product_name}*\n`;
            quoteTxt += `   ${item.m2_requested} m² + 10% = ${item.m2_with_merma} m² (${item.boxes} cajas)\n`;
            if (item.subtotal) quoteTxt += `   Subtotal: $${Math.round(item.subtotal).toLocaleString('es-MX')}\n`;
            quoteTxt += `\n`;
          }
          quoteTxt += `${'─'.repeat(20)}\n`;
          quoteTxt += `📦 *Total: ${grandM2.toFixed(1)} m²*\n`;
          if (grandTotal > 0) quoteTxt += `💰 *TOTAL: $${Math.round(grandTotal).toLocaleString('es-MX')} MXN*\n`;
          quoteTxt += `\n📋 *Ver cotización completa:*\n${quoteUrl}\n`;
          quoteTxt += `\n_Vigencia: 15 días_`;

          await sendWhatsApp(from, quoteTxt);

          // 7. Notify store advisor
          const store = lead?.store_id ? await queryOne('SELECT * FROM stores WHERE id = ?', [lead.store_id]) : null;
          if (store?.whatsapp) {
            await sendWhatsAppTemplate(store.whatsapp, 'lead_nuevo', [
              leadName, from, store?.name || 'Tienda', `Cotización ${folio}: ${parsedItems.length} productos, $${Math.round(grandTotal).toLocaleString('es-MX')}`
            ]);
          }

          // 8. Clear quote items for next session
          await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[QUOTE_ITEM]%'", [from]);

          console.log(`📄 Quote ${folio} created: ${parsedItems.length} items, $${Math.round(grandTotal)}`);

          await new Promise(r => setTimeout(r, 500));
          await sendWhatsAppButtons(from, '¡Tu cotización está lista! ¿Qué quieres hacer?', [
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

          // Save pick (accumulate selections)
          await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
            [from, 'assistant', `[CATALOG_PICK] ${selectedProduct.sku || selectedProduct.id}`]);
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

          // Count how many picks so far
          const pickCount = await scalar(
            "SELECT COUNT(*) FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[CATALOG_PICK]%'", [from]);

          await sendWhatsApp(from, `✅ *${selectedProduct.name}* agregado (${pickCount} seleccionados)`);
          await new Promise(r => setTimeout(r, 300));
          const catBtns = [
            { id: 'ver_mas_catalogo', title: '📋 Elegir otro piso' },
            { id: 'cotizar_seleccion', title: `📐 Cotizar mis ${pickCount}` }
          ];
          catBtns.push(pickCount >= 2
            ? { id: 'comparar_seleccion', title: `⚖️ Comparar ${pickCount}` }
            : { id: 'ver_seleccionados', title: `👁️ Ver mis ${pickCount} pisos` }
          );
          await sendWhatsAppButtons(from, '¿Qué quieres hacer?', catBtns);
        } else {
          await sendWhatsApp(from, `No encontré ese producto. Escríbeme el nombre del piso que te interesa. 😊`);
        }

      } else if (btnId === 'cotizar_seleccion') {
        // Start sequential m² collection for all selected products
        const picks = await query(
          "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[CATALOG_PICK]%' ORDER BY created_at ASC",
          [from]);

        if (picks.length === 0) {
          await sendWhatsApp(from, 'No tienes pisos seleccionados. Escríbeme _pisos de madera_ o el estilo que buscas. 😊');
        } else {
          // Deduplicate
          const seen = new Set();
          const uniqueRefs = [];
          for (const p of picks) {
            const ref = p.message.replace('[CATALOG_PICK] ', '').trim();
            if (!seen.has(ref)) { seen.add(ref); uniqueRefs.push(ref); }
          }

          // Clear old picks and COTIZAR_QUEUE
          await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[CATALOG_PICK]%'", [from]);
          await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'system' AND message LIKE '[COTIZAR_QUEUE]%'", [from]);
          await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[QUOTE_ITEM]%'", [from]);

          // Save queue: each product to cotizar
          for (let i = 0; i < uniqueRefs.length; i++) {
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
              [from, 'system', `[COTIZAR_QUEUE] ${i}|${uniqueRefs[i]}`]);
          }

          // Ask m² for the first product
          const firstProduct = await queryOne('SELECT * FROM products WHERE sku = ? OR id::text = ?', [uniqueRefs[0], uniqueRefs[0]]);
          const firstName = firstProduct?.name || uniqueRefs[0];

          await addLeadScore(from, 20, 'cotizar_seleccion');

          if (uniqueRefs.length === 1) {
            await sendWhatsApp(from, `📐 *Cotizando ${firstName}*\n\n¿Cuántos m² necesitas?\n_Escribe el número, ej: 50_`);
          } else {
            await sendWhatsApp(from, `📐 *Cotizando ${uniqueRefs.length} pisos*\n\nEmpecemos con *${firstName}*\n¿Cuántos m² necesitas?\n_Escribe el número, ej: 50_`);
          }
        }

      } else if (btnId === 'comparar_seleccion') {
        // Compare selected catalog picks side by side
        const picks = await query(
          "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[CATALOG_PICK]%' ORDER BY created_at ASC",
          [from]);

        const seen = new Set();
        const uniqueRefs = [];
        for (const p of picks) {
          const ref = p.message.replace('[CATALOG_PICK] ', '').trim();
          if (!seen.has(ref)) { seen.add(ref); uniqueRefs.push(ref); }
        }

        if (uniqueRefs.length < 2) {
          await sendWhatsApp(from, 'Necesitas al menos 2 pisos para comparar. Elige otro piso primero.');
        } else {
          const compareProducts = [];
          for (const ref of uniqueRefs) {
            const p = await queryOne('SELECT * FROM products WHERE sku = ? OR id::text = ?', [ref, ref]);
            if (p) compareProducts.push(p);
          }

          if (compareProducts.length < 2) {
            await sendWhatsApp(from, 'No encontré los productos. Intenta elegirlos de nuevo.');
          } else {
            // Send images
            for (const p of compareProducts) {
              if (p.image_url) {
                await sendWhatsAppImage(from, p.image_url, `*${p.name}*`);
                await new Promise(r => setTimeout(r, 500));
              }
            }

            // Build comparison text
            let comp = `⚖️ *COMPARADOR DE PISOS*\n${'─'.repeat(24)}\n\n`;
            const specs = [
              { e: '💰', l: 'Precio', fn: p => `$${p.base_price || '?'}/m²` },
              { e: '📐', l: 'Formato', fn: p => p.format || '-' },
              { e: '✨', l: 'Acabado', fn: p => p.finish || '-' },
              { e: '💪', l: 'PEI', fn: p => p.pei ? `PEI ${p.pei}` : '-' },
              { e: '📦', l: 'm²/caja', fn: p => p.sqm_per_box ? `${p.sqm_per_box} m²` : '-' },
              { e: '🏠', l: 'Uso', fn: p => p.usage || '-' }
            ];

            for (const p of compareProducts) {
              comp += `*${p.name}*\n`;
              for (const s of specs) comp += `  ${s.e} ${s.l}: ${s.fn(p)}\n`;
              comp += `\n`;
            }

            const ids = compareProducts.map(p => p.sku || p.id).join(',');
            comp += `🔗 *Ver comparación completa:*\n${BASE_URL}/comparar/${ids}`;

            await sendWhatsApp(from, comp);
            await new Promise(r => setTimeout(r, 500));
            await sendWhatsAppButtons(from, '¿Qué sigue?', [
              { id: 'cotizar_seleccion', title: `📐 Cotizar mis ${uniqueRefs.length}` },
              { id: 'ver_mas_catalogo', title: '📋 Elegir otro piso' },
              { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
            ]);
          }
        }

      } else if (btnId === 'ver_seleccionados') {
        // Show all accumulated catalog picks with full details
        const picks = await query(
          "SELECT message FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[CATALOG_PICK]%' ORDER BY created_at ASC",
          [from]);

        if (picks.length === 0) {
          await sendWhatsApp(from, 'No tienes pisos seleccionados aún. Escríbeme _pisos de madera_ o el estilo que buscas. 😊');
        } else {
          const baseUrl = 'https://cesantoni-experience-za74.onrender.com';
          // Deduplicate picks
          const seen = new Set();
          const uniqueRefs = [];
          for (const p of picks) {
            const ref = p.message.replace('[CATALOG_PICK] ', '').trim();
            if (!seen.has(ref)) { seen.add(ref); uniqueRefs.push(ref); }
          }

          await sendWhatsApp(from, `🏠 *Tus ${uniqueRefs.length} pisos seleccionados:*`);
          await new Promise(r => setTimeout(r, 400));

          for (const ref of uniqueRefs) {
            const sp = await queryOne('SELECT * FROM products WHERE sku = ? OR id::text = ?', [ref, ref]);
            if (!sp) continue;
            const link = `${baseUrl}/p/${sp.sku || sp.slug}`;
            const pei = parseInt(sp.pei) || 0;
            const peiTip = pei >= 4 ? 'Alto tráfico' : pei >= 3 ? 'Toda la casa' : pei >= 2 ? 'Tráfico ligero' : '';
            let caption = `*${sp.name}*\n`;
            caption += `💰 $${sp.base_price || '?'}/m²\n`;
            caption += `📐 ${sp.format || '-'} · ✨ ${sp.finish || '-'}\n`;
            if (pei) caption += `💪 PEI ${pei} — ${peiTip}\n`;
            if (sp.sqm_per_box) caption += `📦 ${sp.sqm_per_box} m²/caja\n`;
            caption += `🔗 ${link}`;

            if (sp.image_url) {
              await sendWhatsAppImage(from, sp.image_url, caption);
            } else {
              await sendWhatsApp(from, caption);
            }
            await new Promise(r => setTimeout(r, 800));
          }

          // Clear picks after showing
          await run("DELETE FROM wa_conversations WHERE phone = ? AND role = 'assistant' AND message LIKE '[CATALOG_PICK]%'", [from]);

          // Re-insert picks for cotizar (they were cleared above for display)
          for (const ref of uniqueRefs) {
            await run('INSERT INTO wa_conversations (phone, role, message) VALUES (?, ?, ?)',
              [from, 'assistant', `[CATALOG_PICK] ${ref}`]);
          }

          await new Promise(r => setTimeout(r, 500));
          const vsBtns = [
            { id: 'cotizar_seleccion', title: `📐 Cotizar ${uniqueRefs.length} pisos` },
            uniqueRefs.length >= 2
              ? { id: 'comparar_seleccion', title: `⚖️ Comparar ${uniqueRefs.length}` }
              : { id: 'ver_mas_catalogo', title: '📋 Agregar otro' },
            { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
          ];
          await sendWhatsAppButtons(from, `Esos son tus ${uniqueRefs.length} favoritos. ¿Qué sigue?`, vsBtns);
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
              description: `~$${s.base_price || '?'}/m² est. · ${s.format || ''} · ${s.finish || ''}`
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
        const { reply, product } = await processWhatsAppMessage(from, btnTitle, contactName);
        if (product?.image_url) {
          const slug = product.sku || product.slug;
          const caption = `${reply}\n\n*${product.name}*${product.base_price ? ' · ~$' + product.base_price + '/m² (precio estimado)' : ''}\n\nhttps://cesantoni-experience-za74.onrender.com/p/${slug}`;
          await sendWhatsAppImage(from, product.image_url, caption);
        } else {
          await sendWhatsApp(from, reply);
        }
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
            const { reply, product } = await processWhatsAppMessage(from, transcription, contactName);
            if (product?.image_url) {
              const slug = product.sku || product.slug;
              const caption = `${reply}\n\n*${product.name}*${product.base_price ? ' · ~$' + product.base_price + '/m² (precio estimado)' : ''}\n\nhttps://cesantoni-experience-za74.onrender.com/p/${slug}`;
              await sendWhatsAppImage(from, product.image_url, caption);
            } else {
              await sendWhatsApp(from, reply);
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
              let caption = `*${s.name}* · ~$${s.base_price || '?'}/m² (estimado)\n`;
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

    } else if (message.type === 'location') {
      // User shared their location — find nearest stores
      const userLat = message.location.latitude;
      const userLng = message.location.longitude;
      console.log(`📍 Location from ${from}: ${userLat}, ${userLng}`);

      const allStores = await query(`
        SELECT s.*, d.name as distributor_name
        FROM stores s JOIN distributors d ON s.distributor_id = d.id
        WHERE s.active = 1 AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      `);

      const nearest = allStores.map(s => ({
        ...s,
        dist: haversine(userLat, userLng, s.lat, s.lng)
      })).sort((a, b) => a.dist - b.dist).slice(0, 5);

      if (nearest.length > 0) {
        let msg = `📍 *Tiendas Cesantoni cerca de ti:*\n\n`;
        for (const s of nearest) {
          msg += `🏪 *${s.name}*\n`;
          msg += `   ${s.distributor_name}`;
          if (s.promo_text) msg += ` · ${s.promo_text}`;
          msg += `\n`;
          if (s.address) msg += `   ${s.address}\n`;
          msg += `   📏 *${s.dist.toFixed(1)} km*\n`;
          if (s.whatsapp) msg += `   💬 wa.me/${s.whatsapp.replace(/\D/g, '')}\n`;
          msg += `\n`;
        }
        msg += `🗺️ Ver todas: ${BASE_URL}/tiendas`;
        await sendWhatsApp(from, msg);
      } else {
        await sendWhatsApp(from, 'Aún no tenemos tiendas con ubicación registrada. Escríbeme tu ciudad y te busco la más cercana. 🏪');
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
    const { status, source, days, sort } = req.query;
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
    if (sort === 'hot') { sql += ' AND COALESCE(l.score, 0) >= 50'; }
    if (sort === 'score') {
      sql += ' ORDER BY COALESCE(l.score, 0) DESC, l.created_at DESC LIMIT 200';
    } else {
      sql += ' ORDER BY l.created_at DESC LIMIT 200';
    }
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

    // Quotes for this lead
    let quotes = [];
    if (lead.phone) {
      quotes = await query('SELECT folio, grand_total, total, status, created_at FROM quotes WHERE customer_phone = ? OR lead_id = ? ORDER BY created_at DESC LIMIT 10', [lead.phone, lead.id]);
    }

    res.json({ ...lead, products_detail, conversation, quotes });
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

// Send message to lead from CRM (handles 24h window)
app.post('/api/leads/:id/send-message', crmAuth, async (req, res) => {
  try {
    const lead = await queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!lead || !lead.phone) return res.status(400).json({ error: 'Lead sin telefono' });

    const { message } = req.body;

    // Check 24h window
    const lastMsg = await queryOne(
      "SELECT created_at FROM wa_conversations WHERE phone = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1",
      [lead.phone]
    );
    const withinWindow = lastMsg && (Date.now() - new Date(lastMsg.created_at).getTime()) < 24 * 60 * 60 * 1000;

    let result;
    if (withinWindow && message) {
      result = await sendWhatsApp(lead.phone, message);
    } else {
      // Outside 24h: use template
      const params = [
        lead.name || 'Cliente',
        lead.phone,
        lead.store_name || 'Cesantoni',
        message || 'Un asesor de Cesantoni quiere ayudarte con tu proyecto de pisos.'
      ];
      result = await sendWhatsAppTemplate(lead.phone, 'lead_nuevo', params);
    }

    if (result?.error) {
      return res.status(400).json({ error: result.error.message || 'Error enviando mensaje' });
    }

    // Update status if new
    await run("UPDATE leads SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [lead.id]);

    res.json({ success: true, withinWindow, method: withinWindow && message ? 'freeform' : 'template' });
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
    const recent = await query("SELECT id, name, phone, source, COALESCE(score, 0) as score, created_at FROM leads WHERE created_at > ? ORDER BY created_at DESC LIMIT 5", [since]);
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
    const conversations = await scalar(`SELECT COUNT(DISTINCT phone) FROM wa_conversations WHERE role = 'user' AND created_at >= ${dateFilter}`) || 0;
    const totalLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE created_at >= ${dateFilter}`) || 0;
    const landingLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE source = 'landing' AND created_at >= ${dateFilter}`) || 0;
    const terraLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE source = 'terra_qr' AND created_at >= ${dateFilter}`) || 0;
    const waLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE source = 'whatsapp_bot' AND created_at >= ${dateFilter}`) || 0;
    const contacted = await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'contacted' AND created_at >= ${dateFilter}`) || 0;
    const converted = await scalar(`SELECT COUNT(*) FROM leads WHERE status = 'converted' AND created_at >= ${dateFilter}`) || 0;

    // Quotes data
    const quotesCount = await scalar(`SELECT COUNT(*) FROM quotes WHERE created_at >= ${dateFilter}`) || 0;
    const quotesTotal = await scalar(`SELECT COALESCE(SUM(grand_total), SUM(total), 0) FROM quotes WHERE created_at >= ${dateFilter}`) || 0;

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

    // Top products quoted
    const topQuoted = await query(`
      SELECT qi.product_name as name, COUNT(*) as quotes, SUM(COALESCE(qi.subtotal, 0)) as revenue
      FROM quote_items qi JOIN quotes q ON qi.quote_id = q.id
      WHERE q.created_at >= ${dateFilter}
      GROUP BY qi.product_name ORDER BY quotes DESC LIMIT 5
    `).catch(() => []);

    // Top stores by scans
    const topStores = await query(`
      SELECT st.name, st.state, COUNT(s.id) as scans
      FROM scans s JOIN stores st ON s.store_id = st.id
      WHERE s.created_at >= ${dateFilter}
      GROUP BY st.id, st.name, st.state ORDER BY scans DESC LIMIT 5
    `);

    res.json({
      period_days: days,
      funnel: { scans, wa_clicks: waClicks, conversations, leads: totalLeads, quotes: quotesCount, contacted, converted },
      leads_by_source: { landing: landingLeads, terra_qr: terraLeads, whatsapp_bot: waLeads },
      quotes_summary: { count: quotesCount, total_value: Math.round(quotesTotal) },
      conversion_rates: {
        scan_to_click: scans > 0 ? ((waClicks / scans) * 100).toFixed(1) : '0',
        click_to_lead: waClicks > 0 ? ((totalLeads / waClicks) * 100).toFixed(1) : '0',
        lead_to_contacted: totalLeads > 0 ? ((contacted / totalLeads) * 100).toFixed(1) : '0',
        lead_to_converted: totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0',
        lead_to_quote: totalLeads > 0 ? ((quotesCount / totalLeads) * 100).toFixed(1) : '0',
        overall: scans > 0 ? ((converted / scans) * 100).toFixed(1) : '0'
      },
      daily_scans: daily,
      daily_leads: dailyLeads,
      top_products: topProducts,
      top_quoted: topQuoted,
      top_stores: topStores
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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`,
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
            maxOutputTokens: 1024
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error('Gemini error:', JSON.stringify(data.error));
      return res.status(500).json({ error: 'Error al procesar tu pregunta', detail: data.error.message || data.error.status || 'unknown' });
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

  // CRON: Smart follow-up system (every 30 minutes)
  // Replaces old follow-up + abandoned cart CRONs with 3-stage intelligent follow-up
  setInterval(async () => {
    try {
      // Find leads eligible for follow-up
      const candidates = await query(`
        SELECT l.*, s.whatsapp as store_whatsapp, s.name as store_display_name
        FROM leads l
        LEFT JOIN stores s ON l.store_id = s.id
        WHERE l.status IN ('new', 'follow_up')
          AND l.phone IS NOT NULL
          AND COALESCE(l.followup_stage, 0) < 3
          AND l.created_at < NOW() - INTERVAL '6 hours'
        ORDER BY l.created_at ASC
        LIMIT 20
      `);

      if (candidates.length === 0) return;
      console.log(`⏰ CRON Smart Follow-up: ${candidates.length} candidates`);

      for (const lead of candidates) {
        const currentStage = lead.followup_stage || 0;
        const lastFollowup = lead.last_followup_at ? new Date(lead.last_followup_at) : null;
        const lastUserMsg = lead.last_user_msg_at ? new Date(lead.last_user_msg_at) : null;
        const createdAt = new Date(lead.created_at);
        const now = Date.now();

        const hoursSinceCreation = (now - createdAt.getTime()) / (1000 * 60 * 60);
        const hoursSinceLastFollowup = lastFollowup ? (now - lastFollowup.getTime()) / (1000 * 60 * 60) : Infinity;
        const hoursSinceLastUserMsg = lastUserMsg ? (now - lastUserMsg.getTime()) / (1000 * 60 * 60) : Infinity;

        // STOP: User replied after our last follow-up (they're engaged)
        if (lastUserMsg && lastFollowup && lastUserMsg > lastFollowup) continue;

        // Determine target stage
        let targetStage = 0;
        let shouldSend = false;

        if (currentStage === 0 && hoursSinceCreation >= 6) {
          targetStage = 1; shouldSend = true; // Stage 1: ~6h after creation
        } else if (currentStage === 1 && hoursSinceLastFollowup >= 18) {
          targetStage = 2; shouldSend = true; // Stage 2: ~24h total
        } else if (currentStage === 2 && hoursSinceLastFollowup >= 48) {
          targetStage = 3; shouldSend = true; // Stage 3: ~72h total
        }

        if (!shouldSend) continue;

        // Check if within 24h window (can send regular message)
        const withinWindow = hoursSinceLastUserMsg <= 24;

        // Get product info for personalization
        let prodName = 'pisos Cesantoni';
        try { const prods = lead.products_interested ? JSON.parse(lead.products_interested) : []; prodName = prods[0] || prodName; } catch(e) {}
        const leadName = lead.name || 'Cliente';
        const quoteFolio = lead.last_quote_folio;
        const quoteUrl = quoteFolio ? `${BASE_URL}/cotizacion/${quoteFolio}` : null;

        // MARK BEFORE SEND (prevent duplicate sends)
        await run(
          "UPDATE leads SET followup_stage = ?, last_followup_at = CURRENT_TIMESTAMP, followup_count = COALESCE(followup_count, 0) + 1, status = 'follow_up', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [targetStage, lead.id]
        );

        let sent = false;

        if (targetStage === 1) {
          // Stage 1: Soft reminder
          if (withinWindow) {
            const msg = quoteFolio
              ? `Hola ${leadName}! 👋 Vi que te interesó *${prodName}*. Tu cotización ${quoteFolio} sigue disponible:\n${quoteUrl}\n\n¿Te puedo ayudar con algo más?`
              : `Hola ${leadName}! 👋 Vi que te interesó *${prodName}*. ¿Quieres que te cotice los m² o prefieres hablar con un asesor?`;
            const result = await sendWhatsAppButtons(lead.phone, msg, [
              { id: 'enviar_cotizacion', title: '📄 Ver cotización' },
              { id: 'hablar_asesor', title: '👤 Hablar c/asesor' }
            ]);
            sent = !result?.error;
          } else {
            const result = await sendWhatsAppTemplate(lead.phone, 'lead_nuevo', [
              leadName, lead.phone, lead.store_name || 'Cesantoni',
              `Recordatorio: te interesó ${prodName}. ¡Respóndeme y te ayudo!`
            ]);
            sent = !result?.error;
          }
        } else if (targetStage === 2) {
          // Stage 2: Check-in with quote reference
          const msg4 = quoteFolio
            ? `Tu cotización ${quoteFolio} de ${prodName} sigue vigente. ¡Respóndeme si tienes dudas!`
            : `¿Seguimos con ${prodName}? Un asesor puede ayudarte a elegir.`;
          const result = await sendWhatsAppTemplate(lead.phone, 'lead_nuevo', [
            leadName, lead.phone, lead.store_name || 'Cesantoni', msg4
          ]);
          sent = !result?.error;
        } else if (targetStage === 3) {
          // Stage 3: Last chance
          const msg4 = quoteFolio
            ? `Última oportunidad: tu cotización ${quoteFolio} vence pronto. ¡No te lo pierdas!`
            : `Último aviso: ${prodName} tiene alta demanda. ¡Contáctame antes de que se agote!`;
          const result = await sendWhatsAppTemplate(lead.phone, 'lead_nuevo', [
            leadName, lead.phone, lead.store_name || 'Cesantoni', msg4
          ]);
          sent = !result?.error;
        }

        if (sent) {
          console.log(`  📩 Follow-up stage ${targetStage} sent to ${leadName} (${lead.phone})`);
        } else {
          // Rollback on failure
          await run("UPDATE leads SET followup_stage = ?, followup_count = GREATEST(COALESCE(followup_count, 1) - 1, 0) WHERE id = ?",
            [currentStage, lead.id]);
          console.error(`  ❌ Follow-up stage ${targetStage} FAILED for ${lead.phone}`);
        }

        await new Promise(r => setTimeout(r, 2000)); // Rate limit
      }
    } catch (e) {
      console.error('CRON smart follow-up error:', e.message);
    }
  }, 30 * 60 * 1000); // Every 30 minutes
  console.log('   ⏰ CRON smart follow-up active (every 30min, 3 stages)');

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
