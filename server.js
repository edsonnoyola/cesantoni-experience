const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');
const { initDB, query, queryOne, run, scalar } = require('./database');
const { execSync } = require('child_process');
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
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// =====================================================
// API: TRACKING
// =====================================================

app.post('/api/track/scan', (req, res) => {
  try {
    const { product_id, store_id, session_id, utm_source, utm_medium, utm_campaign } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;
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

// Alias para landing.html
app.post('/api/scans', (req, res) => {
  try {
    const { product_id, store_id, session_id } = req.body;
    const ip_address = req.ip || req.connection.remoteAddress;
    const user_agent = req.headers['user-agent'] || '';
    const referrer = req.headers.referer || req.headers.referrer || '';

    const result = run(`
      INSERT INTO scans (product_id, store_id, session_id, ip_address, user_agent, referrer)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [product_id, store_id || null, session_id, ip_address, user_agent, referrer]);

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

// =====================================================
// LANDING PAGE DINÁMICO
// =====================================================

app.get('/p/:sku', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/api/landing/:sku', (req, res) => {
  try {
    const product = queryOne('SELECT * FROM products WHERE LOWER(sku) = LOWER(?)', [req.params.sku]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para el landing - obtiene producto + promoción
app.get('/api/promotions/for-product/:sku', (req, res) => {
  try {
    const sku = req.params.sku;
    const { store_slug, state, distributor } = req.query;
    
    // Buscar producto por SKU
    const product = queryOne('SELECT * FROM products WHERE LOWER(sku) = LOWER(?)', [sku]);
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
  
  const { product_id, product_name, product_description, image_url } = req.body;
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

    const prompt = `Animate this floor image. Keep the EXACT same tile pattern and color. Slow camera pan revealing more of the same floor. Do not change or replace the tiles. Maintain the original texture throughout. Soft natural light. Gentle ambient room sounds.`;

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
    const tempWithMusic = path.join(__dirname, 'public', 'videos', `temp_music_${videoId}.mp4`);
    const finalPath = path.join(__dirname, 'public', 'videos', `${slug}.mp4`);

    console.log('📥 Descargando video...');
    execSync(`curl -L -o "${tempPath}" "${videoUri}&key=${GOOGLE_API_KEY}"`);

    // Seleccionar música aleatoria
    const musicDir = path.join(__dirname, 'public', 'music');
    let musicPath = null;
    if (fs.existsSync(musicDir)) {
      const tracks = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3'));
      if (tracks.length > 0) {
        const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];
        musicPath = path.join(musicDir, randomTrack);
        console.log('🎵 Usando música:', randomTrack);
      }
    }

    console.log('🎨 Procesando video (logo + música)...');
    try {
      if (musicPath && fs.existsSync(musicPath)) {
        // Video + Logo + Música
        // Primero agregar música (mezclar con audio original más bajo)
        execSync(`${FFMPEG} -i "${tempPath}" -i "${musicPath}" -filter_complex "[0:a]volume=0.3[a1];[1:a]volume=0.7[a2];[a1][a2]amix=inputs=2:duration=shortest[aout]" -map 0:v -map "[aout]" -c:v copy -shortest "${tempWithMusic}" -y`);
        
        // Luego agregar logo
        execSync(`${FFMPEG} -i "${tempWithMusic}" -i "${LOGO_PATH}" -filter_complex "[1:v]scale=200:-1[logo];[0:v][logo]overlay=W-w-20:H-h-20" -c:a copy "${finalPath}" -y`);
        
        fs.unlinkSync(tempWithMusic);
      } else {
        // Solo logo, sin música
        execSync(`${FFMPEG} -i "${tempPath}" -i "${LOGO_PATH}" -filter_complex "[1:v]scale=200:-1[logo];[0:v][logo]overlay=W-w-20:H-h-20" -c:a copy "${finalPath}" -y`);
      }
      fs.unlinkSync(tempPath);
    } catch (ffmpegErr) {
      console.log('⚠️ FFmpeg error:', ffmpegErr.message);
      // Fallback: usar video sin procesar
      if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, finalPath);
      }
    }

    if (product_id) {
      run('UPDATE products SET video_url = ? WHERE id = ?', [`/videos/${slug}.mp4`, product_id]);
    }

    console.log('✅ Video listo:', `/videos/${slug}.mp4`);
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
