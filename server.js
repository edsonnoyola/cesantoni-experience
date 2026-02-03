const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');
const { initDB, query, queryOne, run, scalar } = require('./database');
const { execSync } = require('child_process');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Borrar video de un producto
app.delete('/api/products/:id/video', (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const product = queryOne('SELECT * FROM products WHERE id = ?', [productId]);
    
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
    run('UPDATE products SET video_url = NULL WHERE id = ?', [productId]);
    
    res.json({ message: 'Video eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: DISTRIBUIDORES
// =====================================================

app.get('/api/distributors', (req, res) => {
  try {
    const distributors = query('SELECT * FROM distributors WHERE active = 1 ORDER BY name');
    res.json(distributors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/distributors/:id', (req, res) => {
  try {
    const distributor = queryOne('SELECT * FROM distributors WHERE id = ?', [parseInt(req.params.id)]);
    if (!distributor) return res.status(404).json({ error: 'Distribuidor no encontrado' });
    
    const stores = query('SELECT * FROM stores WHERE distributor_id = ? AND active = 1', [parseInt(req.params.id)]);
    res.json({ ...distributor, stores });
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

app.put('/api/distributors/:id', (req, res) => {
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
    run(`UPDATE distributors SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ message: 'Distribuidor actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: TIENDAS
// =====================================================

app.get('/api/stores', (req, res) => {
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
    const stores = query(sql, params);
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stores/:id', (req, res) => {
  try {
    const store = queryOne(`
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

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(req.params.id);
    run(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ message: 'Tienda actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: TRACKING
// =====================================================

app.post('/api/track/scan', (req, res) => {
  try {
    const { product_id, store_id, session_id, utm_source, utm_medium, utm_campaign, source } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;
    const user_agent = req.headers['user-agent'] || '';
    const referrer = req.headers.referer || req.headers.referrer || '';

    // source puede ser 'qr' o 'nfc'
    const scan_source = source || 'qr';

    const result = run(`
      INSERT INTO scans (product_id, store_id, session_id, ip_address, user_agent, referrer, utm_source, utm_medium, utm_campaign, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [product_id, store_id || null, session_id, ip_address, user_agent, referrer, utm_source || null, utm_medium || null, utm_campaign || null, scan_source]);

    res.json({ scan_id: result.lastInsertRowid, message: 'Escaneo registrado', source: scan_source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registrar escaneo QR/NFC
app.post('/api/scans', (req, res) => {
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

    const result = run(`
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
app.delete('/api/admin/scans', (req, res) => {
  try {
    run('DELETE FROM scans');
    run('DELETE FROM whatsapp_clicks');
    res.json({ message: 'Todos los scans y clicks borrados', success: true });
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
        st.id, st.name, st.state, st.city,
        d.name as distributor_name,
        COUNT(s.id) as scans,
        COUNT(w.id) as clicks
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

    res.json(query(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analytics NFC vs QR
app.get('/api/analytics/by-source', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const data = query(`
      SELECT
        COALESCE(source, 'qr') as source,
        COUNT(*) as scans,
        COUNT(DISTINCT product_id) as unique_products,
        COUNT(DISTINCT store_id) as unique_stores,
        COUNT(DISTINCT session_id) as unique_sessions
      FROM scans
      WHERE created_at >= datetime('now', '-${days} days')
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

    run(`
      INSERT OR REPLACE INTO qr_codes (product_id, store_id, url, qr_data)
      VALUES (?, ?, ?, ?)
    `, [product_id, store_id, url, qrDataUrl]);

    res.json({ url, qr_data: qrDataUrl, product: product.name, store: store.name });
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

    if (product_id) { sql += ' AND qr.product_id = ?'; params.push(parseInt(product_id)); }
    if (store_id) { sql += ' AND qr.store_id = ?'; params.push(parseInt(store_id)); }

    sql += ' ORDER BY qr.created_at DESC';
    res.json(query(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: UTILIDADES
// =====================================================

app.get('/api/states', (req, res) => {
  try {
    res.json(query(`SELECT DISTINCT state, COUNT(*) as store_count FROM stores WHERE active = 1 GROUP BY state ORDER BY state`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/categories', (req, res) => {
  try {
    res.json(query(`SELECT DISTINCT category, COUNT(*) as product_count FROM products WHERE active = 1 AND category IS NOT NULL GROUP BY category ORDER BY category`));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: PROMOTIONS
app.get('/api/promotions', (req, res) => {
  try {
    // Intentar obtener promociones si existe la tabla
    let promotions = [];
    try {
      promotions = query(`
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

app.get('/p/:sku', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/api/landing/:identifier', (req, res) => {
  try {
    // Buscar por SKU o por slug
    const id = req.params.identifier;
    const product = queryOne(
      'SELECT * FROM products WHERE LOWER(sku) = LOWER(?) OR LOWER(slug) = LOWER(?)',
      [id, id]
    );
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para el landing - obtiene producto + promoción
app.get('/api/promotions/for-product/:identifier', (req, res) => {
  try {
    const identifier = req.params.identifier;
    const { store_slug, state, distributor } = req.query;

    // Buscar producto por SKU o por slug
    const product = queryOne(
      'SELECT * FROM products WHERE LOWER(sku) = LOWER(?) OR LOWER(slug) = LOWER(?)',
      [identifier, identifier]
    );
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    
    // Buscar promoción activa para este producto
    let promotion = null;
    let final_price = product.base_price || 0;
    let has_promotion = false;
    
    // Intentar encontrar promoción (si existe tabla promotions)
    try {
      promotion = queryOne(`
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
  
  // Si no viene descripción, buscarla en la DB
  if (!product_description && product_id) {
    const product = queryOne('SELECT description FROM products WHERE id = ?', [product_id]);
    if (product && product.description) {
      product_description = product.description;
      console.log('📝 Descripción obtenida de DB');
    }
  }
  const videoId = Date.now();
  const slug = (product_name || 'video').toLowerCase().replace(/\s+/g, '_');
  
  console.log('🎬 Generando video para:', product_name);
  console.log('📷 Imagen de referencia:', image_url);
  res.json({ success: true, videoId, slug, message: 'Generando video...' });

  try {
    // Descargar imagen del producto y convertir a base64
    let imageBase64 = null;
    let imageMimeType = 'image/jpeg';
    
    if (image_url) {
      console.log('📥 Descargando imagen del producto...');
      try {
        const imgResponse = await fetch(image_url);
        const imgBuffer = await imgResponse.arrayBuffer();
        imageBase64 = Buffer.from(imgBuffer).toString('base64');
        
        // Detectar mime type
        if (image_url.includes('.png')) imageMimeType = 'image/png';
        else if (image_url.includes('.webp')) imageMimeType = 'image/webp';
        
        console.log('✅ Imagen descargada y convertida a base64');
      } catch (imgErr) {
        console.log('⚠️ No se pudo descargar imagen, continuando sin referencia:', imgErr.message);
      }
    }

    // Construir prompt con narración para que Veo genere la voz
    let prompt = `Cinematic slow motion video of ceramic tiles and interior design. Gentle camera movement. Professional architecture photography style. Elegant home decor. Soft ambient lighting. No people.`;
    
    // Si hay descripción, agregar narración al prompt
    if (product_description) {
      prompt = `A warm female voice with Mexican Spanish accent narrates: "${product_description}". Cinematic slow motion video showcasing elegant ceramic floor tiles. Gentle camera pan. Soft piano music in background. Professional interior design photography. Elegant ambient lighting. No people.`;
      console.log('🎤 Prompt incluye narración de voz');
    }

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
          sampleCount: 1
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
      
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${GOOGLE_API_KEY}`;
      console.log('🚀 Enviando request a Veo API...');
      
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
      // Si falla con imagen, intentar sin ella
      if (imageBase64) {
        console.log('⚠️ Reintentando sin imagen...', apiErr.message);
        const requestBody = {
          instances: [{ prompt: prompt }],
          parameters: { aspectRatio: "16:9", sampleCount: 1 }
        };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${GOOGLE_API_KEY}`;
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        
        const responseText = await response.text();
        console.log('📡 Retry status:', response.status);
        
        if (!responseText) {
          throw new Error('Respuesta vacía en retry');
        }
        
        result = JSON.parse(responseText);
        
        if (result.error) {
          throw new Error(result.error.message);
        }
      } else {
        throw apiErr;
      }
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
      run('UPDATE products SET video_url = ? WHERE id = ?', [finalVideoUrl, product_id]);
    }

    console.log('✅ Video listo:', finalVideoUrl);
  } catch (error) {
    console.error('Error generando video:', error.message);
  }
});

app.get('/api/videos', (req, res) => {
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

// Crear tabla landings si no existe (definir antes de usar)
const createLandingsTable = () => {
  run(`CREATE TABLE IF NOT EXISTS landings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    promo_text TEXT,
    video_url TEXT,
    image_url TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
};

app.get('/api/landings', (req, res) => {
  try {
    createLandingsTable();
    const landings = query(`
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
app.get('/api/landings/db', (req, res) => {
  try {
    createLandingsTable();
    const landings = query(`
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
app.get('/api/landings/db/:id', (req, res) => {
  try {
    const landing = queryOne(`
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
app.get('/api/landings/by-product/:sku', (req, res) => {
  try {
    createLandingsTable();
    const landing = queryOne(`
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
app.post('/api/landings', (req, res) => {
  try {
    createLandingsTable();
    const { product_id, title, description, promo_text, video_url, image_url } = req.body;
    
    // Check if landing already exists for this product
    const existing = queryOne('SELECT id FROM landings WHERE product_id = ?', [product_id]);
    
    if (existing) {
      // Update existing
      run(`UPDATE landings SET title=?, description=?, promo_text=?, video_url=?, image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [title, description, promo_text, video_url, image_url, existing.id]);
      res.json({ success: true, id: existing.id, updated: true });
    } else {
      // Create new
      run(`INSERT INTO landings (product_id, title, description, promo_text, video_url, image_url) VALUES (?, ?, ?, ?, ?, ?)`,
        [product_id, title, description, promo_text, video_url, image_url]);
      const newId = scalar('SELECT last_insert_rowid()');
      res.json({ success: true, id: newId, created: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update landing
app.put('/api/landings/:id', (req, res) => {
  try {
    const { title, description, promo_text, video_url, image_url, active } = req.body;
    run(`UPDATE landings SET title=?, description=?, promo_text=?, video_url=?, image_url=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [title, description, promo_text, video_url, image_url, active ?? 1, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE landing
app.delete('/api/landings/:id', (req, res) => {
  try {
    run('DELETE FROM landings WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// SAMPLE REQUESTS - Solicitudes de muestra
// =====================================================

// Create sample request
app.post('/api/samples', (req, res) => {
  try {
    const { product_id, product_name, store_id, store_name, customer_name, customer_phone, customer_email, address } = req.body;

    // Create table if not exists
    run(`CREATE TABLE IF NOT EXISTS sample_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      product_name TEXT,
      store_id INTEGER,
      store_name TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      address TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    const result = run(`INSERT INTO sample_requests (product_id, product_name, store_id, store_name, customer_name, customer_phone, customer_email, address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [product_id, product_name, store_id, store_name, customer_name, customer_phone, customer_email, address]
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Sample request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List sample requests (admin)
app.get('/api/samples', (req, res) => {
  try {
    const samples = query(`SELECT * FROM sample_requests ORDER BY created_at DESC`);
    res.json(samples);
  } catch (err) {
    res.json([]); // Table might not exist yet
  }
});

// Update sample request status
app.put('/api/samples/:id', (req, res) => {
  try {
    const { status, notes } = req.body;
    run(`UPDATE sample_requests SET status = ?, notes = ? WHERE id = ?`, [status, notes, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// QUOTES - Cotizaciones
// =====================================================

// Create quote
app.post('/api/quotes', (req, res) => {
  try {
    const { product_id, product_name, product_sku, m2, price_per_m2, total, store_id, store_name, customer_name, customer_email, customer_phone } = req.body;

    // Create table if not exists
    run(`CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    const result = run(`INSERT INTO quotes (product_id, product_name, product_sku, m2, price_per_m2, total, store_id, store_name, customer_name, customer_email, customer_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [product_id, product_name, product_sku, m2, price_per_m2, total, store_id, store_name, customer_name, customer_email, customer_phone]
    );

    // In a real implementation, you would send an email here
    // For now, just store the quote

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List quotes (admin)
app.get('/api/quotes', (req, res) => {
  try {
    const quotes = query(`SELECT * FROM quotes ORDER BY created_at DESC`);
    res.json(quotes);
  } catch (err) {
    res.json([]); // Table might not exist yet
  }
});

// =====================================================
// REVIEWS - Opiniones
// =====================================================

// Create review
app.post('/api/reviews', (req, res) => {
  try {
    const { product_id, store_id, rating, comment, customer_name } = req.body;

    // Create table if not exists
    run(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      store_id INTEGER,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      customer_name TEXT,
      verified_purchase INTEGER DEFAULT 0,
      approved INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    const result = run(`INSERT INTO reviews (product_id, store_id, rating, comment, customer_name)
      VALUES (?, ?, ?, ?, ?)`,
      [product_id, store_id, rating, comment, customer_name]
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get reviews for product
app.get('/api/products/:id/reviews', (req, res) => {
  try {
    const reviews = query(`SELECT * FROM reviews WHERE product_id = ? AND approved = 1 ORDER BY created_at DESC`, [req.params.id]);

    // Calculate average
    const avgResult = queryOne(`SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE product_id = ? AND approved = 1`, [req.params.id]);

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

async function start() {
  await initDB();
  
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
}

start().catch(console.error);
module.exports = app;
