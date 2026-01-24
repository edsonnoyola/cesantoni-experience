const express = require('express');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));
app.use('/landings', express.static('public/landings'));
app.use('/qrcodes', express.static('public/qrcodes'));
app.use('/uploads', express.static('data/uploads'));

// Multer para subir archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'data/uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// =====================
// BASE DE DATOS
// =====================
const db = new Database('data/cesantoni.db');

// Crear tablas
db.exec(`
    -- Productos (fichas técnicas)
    CREATE TABLE IF NOT EXISTS productos (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        tipo TEXT,
        formato TEXT,
        descripcion TEXT,
        acabado TEXT,
        uso TEXT,
        resistencia TEXT,
        absorcion TEXT,
        piezas_caja INTEGER,
        m2_caja REAL,
        imagen_url TEXT,
        video_url TEXT,
        ficha_pdf_url TEXT,
        precio_base REAL,
        tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Distribuidores
    CREATE TABLE IF NOT EXISTS distribuidores (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        tipo TEXT,
        contacto_nombre TEXT,
        contacto_email TEXT,
        contacto_telefono TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tiendas (sucursales de distribuidores)
    CREATE TABLE IF NOT EXISTS tiendas (
        id TEXT PRIMARY KEY,
        distribuidor_id TEXT,
        nombre TEXT NOT NULL,
        estado TEXT,
        ciudad TEXT,
        direccion TEXT,
        codigo_postal TEXT,
        telefono TEXT,
        whatsapp TEXT,
        email TEXT,
        latitud REAL,
        longitud REAL,
        horario TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (distribuidor_id) REFERENCES distribuidores(id)
    );

    -- Precios por tienda (puede variar)
    CREATE TABLE IF NOT EXISTS precios_tienda (
        id TEXT PRIMARY KEY,
        producto_id TEXT,
        tienda_id TEXT,
        precio REAL,
        promocion TEXT,
        promocion_vigente_hasta DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (producto_id) REFERENCES productos(id),
        FOREIGN KEY (tienda_id) REFERENCES tiendas(id)
    );

    -- QR Codes generados
    CREATE TABLE IF NOT EXISTS qr_codes (
        id TEXT PRIMARY KEY,
        producto_id TEXT,
        tienda_id TEXT,
        url TEXT,
        qr_image_path TEXT,
        landing_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (producto_id) REFERENCES productos(id),
        FOREIGN KEY (tienda_id) REFERENCES tiendas(id)
    );

    -- Escaneos (analytics)
    CREATE TABLE IF NOT EXISTS escaneos (
        id TEXT PRIMARY KEY,
        qr_id TEXT,
        producto_id TEXT,
        tienda_id TEXT,
        estado TEXT,
        ciudad TEXT,
        user_agent TEXT,
        ip TEXT,
        referer TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (qr_id) REFERENCES qr_codes(id),
        FOREIGN KEY (producto_id) REFERENCES productos(id),
        FOREIGN KEY (tienda_id) REFERENCES tiendas(id)
    );

    -- Clicks en WhatsApp
    CREATE TABLE IF NOT EXISTS whatsapp_clicks (
        id TEXT PRIMARY KEY,
        escaneo_id TEXT,
        producto_id TEXT,
        tienda_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (escaneo_id) REFERENCES escaneos(id)
    );

    -- Videos generados
    CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        producto_id TEXT,
        status TEXT DEFAULT 'pending',
        prompt TEXT,
        video_url TEXT,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (producto_id) REFERENCES productos(id)
    );

    -- Índices para consultas rápidas
    CREATE INDEX IF NOT EXISTS idx_escaneos_producto ON escaneos(producto_id);
    CREATE INDEX IF NOT EXISTS idx_escaneos_tienda ON escaneos(tienda_id);
    CREATE INDEX IF NOT EXISTS idx_escaneos_estado ON escaneos(estado);
    CREATE INDEX IF NOT EXISTS idx_escaneos_fecha ON escaneos(created_at);
`);

console.log('✅ Base de datos inicializada');

// =====================
// API: PRODUCTOS
// =====================

// Listar todos los productos
app.get('/api/productos', (req, res) => {
    const productos = db.prepare('SELECT * FROM productos ORDER BY nombre').all();
    res.json(productos);
});

// Obtener un producto
app.get('/api/productos/:id', (req, res) => {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(producto);
});

// Crear producto
app.post('/api/productos', (req, res) => {
    const id = uuidv4();
    const { nombre, tipo, formato, descripcion, acabado, uso, resistencia, absorcion, piezas_caja, m2_caja, imagen_url, precio_base, tags } = req.body;
    
    db.prepare(`
        INSERT INTO productos (id, nombre, tipo, formato, descripcion, acabado, uso, resistencia, absorcion, piezas_caja, m2_caja, imagen_url, precio_base, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, nombre, tipo, formato, descripcion, acabado, uso, resistencia, absorcion, piezas_caja, m2_caja, imagen_url, precio_base, tags);
    
    res.json({ id, message: 'Producto creado' });
});

// Actualizar producto
app.put('/api/productos/:id', (req, res) => {
    const { nombre, tipo, formato, descripcion, acabado, uso, resistencia, absorcion, piezas_caja, m2_caja, imagen_url, video_url, precio_base, tags } = req.body;
    
    db.prepare(`
        UPDATE productos SET nombre=?, tipo=?, formato=?, descripcion=?, acabado=?, uso=?, resistencia=?, absorcion=?, piezas_caja=?, m2_caja=?, imagen_url=?, video_url=?, precio_base=?, tags=?, updated_at=CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(nombre, tipo, formato, descripcion, acabado, uso, resistencia, absorcion, piezas_caja, m2_caja, imagen_url, video_url, precio_base, tags, req.params.id);
    
    res.json({ message: 'Producto actualizado' });
});

// Eliminar producto
app.delete('/api/productos/:id', (req, res) => {
    db.prepare('DELETE FROM productos WHERE id = ?').run(req.params.id);
    res.json({ message: 'Producto eliminado' });
});

// =====================
// API: DISTRIBUIDORES
// =====================

app.get('/api/distribuidores', (req, res) => {
    const distribuidores = db.prepare(`
        SELECT d.*, COUNT(t.id) as total_tiendas
        FROM distribuidores d
        LEFT JOIN tiendas t ON t.distribuidor_id = d.id
        GROUP BY d.id
        ORDER BY d.nombre
    `).all();
    res.json(distribuidores);
});

app.post('/api/distribuidores', (req, res) => {
    const id = uuidv4();
    const { nombre, tipo, contacto_nombre, contacto_email, contacto_telefono } = req.body;
    
    db.prepare(`
        INSERT INTO distribuidores (id, nombre, tipo, contacto_nombre, contacto_email, contacto_telefono)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, nombre, tipo, contacto_nombre, contacto_email, contacto_telefono);
    
    res.json({ id, message: 'Distribuidor creado' });
});

// =====================
// API: TIENDAS
// =====================

app.get('/api/tiendas', (req, res) => {
    const { estado, distribuidor_id } = req.query;
    let query = `
        SELECT t.*, d.nombre as distribuidor_nombre,
        (SELECT COUNT(*) FROM escaneos e WHERE e.tienda_id = t.id) as total_escaneos,
        (SELECT COUNT(*) FROM whatsapp_clicks w WHERE w.tienda_id = t.id) as total_whatsapp
        FROM tiendas t
        LEFT JOIN distribuidores d ON d.id = t.distribuidor_id
        WHERE 1=1
    `;
    const params = [];
    
    if (estado) {
        query += ' AND t.estado = ?';
        params.push(estado);
    }
    if (distribuidor_id) {
        query += ' AND t.distribuidor_id = ?';
        params.push(distribuidor_id);
    }
    
    query += ' ORDER BY t.estado, t.ciudad, t.nombre';
    
    const tiendas = db.prepare(query).all(...params);
    res.json(tiendas);
});

app.post('/api/tiendas', (req, res) => {
    const id = uuidv4();
    const { distribuidor_id, nombre, estado, ciudad, direccion, codigo_postal, telefono, whatsapp, email, latitud, longitud, horario } = req.body;
    
    db.prepare(`
        INSERT INTO tiendas (id, distribuidor_id, nombre, estado, ciudad, direccion, codigo_postal, telefono, whatsapp, email, latitud, longitud, horario)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, distribuidor_id, nombre, estado, ciudad, direccion, codigo_postal, telefono, whatsapp, email, latitud, longitud, horario);
    
    res.json({ id, message: 'Tienda creada' });
});

app.get('/api/tiendas/:id', (req, res) => {
    const tienda = db.prepare(`
        SELECT t.*, d.nombre as distribuidor_nombre
        FROM tiendas t
        LEFT JOIN distribuidores d ON d.id = t.distribuidor_id
        WHERE t.id = ?
    `).get(req.params.id);
    
    if (!tienda) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json(tienda);
});

// =====================
// API: PRECIOS POR TIENDA
// =====================

app.get('/api/precios/:producto_id/:tienda_id', (req, res) => {
    const precio = db.prepare(`
        SELECT * FROM precios_tienda 
        WHERE producto_id = ? AND tienda_id = ?
    `).get(req.params.producto_id, req.params.tienda_id);
    
    if (!precio) {
        // Devolver precio base del producto
        const producto = db.prepare('SELECT precio_base FROM productos WHERE id = ?').get(req.params.producto_id);
        return res.json({ precio: producto?.precio_base || 0, promocion: null });
    }
    res.json(precio);
});

app.post('/api/precios', (req, res) => {
    const id = uuidv4();
    const { producto_id, tienda_id, precio, promocion, promocion_vigente_hasta } = req.body;
    
    // Upsert
    db.prepare(`
        INSERT INTO precios_tienda (id, producto_id, tienda_id, precio, promocion, promocion_vigente_hasta)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(producto_id, tienda_id) DO UPDATE SET
        precio = excluded.precio,
        promocion = excluded.promocion,
        promocion_vigente_hasta = excluded.promocion_vigente_hasta
    `).run(id, producto_id, tienda_id, precio, promocion, promocion_vigente_hasta);
    
    res.json({ message: 'Precio guardado' });
});

// =====================
// API: GENERAR QR + LANDING
// =====================

app.post('/api/generar-qr', async (req, res) => {
    try {
        const { producto_id, tienda_id } = req.body;
        
        // Obtener datos
        const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(producto_id);
        const tienda = db.prepare(`
            SELECT t.*, d.nombre as distribuidor_nombre
            FROM tiendas t
            LEFT JOIN distribuidores d ON d.id = t.distribuidor_id
            WHERE t.id = ?
        `).get(tienda_id);
        
        if (!producto || !tienda) {
            return res.status(404).json({ error: 'Producto o tienda no encontrado' });
        }
        
        // Obtener precio específico de la tienda
        const precioData = db.prepare(`
            SELECT * FROM precios_tienda WHERE producto_id = ? AND tienda_id = ?
        `).get(producto_id, tienda_id);
        
        const precio = precioData?.precio || producto.precio_base || 0;
        const promocion = precioData?.promocion || null;
        
        const qrId = uuidv4();
        const slug = `${producto.nombre.toLowerCase().replace(/\s+/g, '-')}-${tienda.nombre.toLowerCase().replace(/\s+/g, '-')}`;
        
        // URL de tracking (landing page)
        const landingUrl = `${BASE_URL}/p/${qrId}`;
        
        // Generar QR Code
        const qrFileName = `qr-${qrId}.png`;
        const qrPath = path.join('public', 'qrcodes', qrFileName);
        await QRCode.toFile(qrPath, landingUrl, {
            width: 400,
            margin: 2,
            color: { dark: '#1a1a1a', light: '#ffffff' }
        });
        
        // Generar Landing Page HTML
        const landingHtml = generateLandingPage(producto, tienda, precio, promocion, qrId);
        const landingFileName = `${qrId}.html`;
        const landingPath = path.join('public', 'landings', landingFileName);
        fs.writeFileSync(landingPath, landingHtml);
        
        // Guardar en BD
        db.prepare(`
            INSERT INTO qr_codes (id, producto_id, tienda_id, url, qr_image_path, landing_path)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(qrId, producto_id, tienda_id, landingUrl, `/qrcodes/${qrFileName}`, `/landings/${landingFileName}`);
        
        res.json({
            id: qrId,
            url: landingUrl,
            qr_image: `${BASE_URL}/qrcodes/${qrFileName}`,
            landing_page: `${BASE_URL}/landings/${landingFileName}`,
            producto: producto.nombre,
            tienda: tienda.nombre
        });
        
    } catch (error) {
        console.error('Error generando QR:', error);
        res.status(500).json({ error: error.message });
    }
});

// =====================
// LANDING PAGE + TRACKING
// =====================

// Ruta de tracking (cuando escanean el QR)
app.get('/p/:qrId', (req, res) => {
    const { qrId } = req.params;
    
    // Obtener datos del QR
    const qr = db.prepare(`
        SELECT q.*, p.nombre as producto_nombre, t.estado, t.ciudad
        FROM qr_codes q
        LEFT JOIN productos p ON p.id = q.producto_id
        LEFT JOIN tiendas t ON t.id = q.tienda_id
        WHERE q.id = ?
    `).get(qrId);
    
    if (!qr) {
        return res.status(404).send('QR no encontrado');
    }
    
    // Registrar escaneo
    const escaneoId = uuidv4();
    db.prepare(`
        INSERT INTO escaneos (id, qr_id, producto_id, tienda_id, estado, ciudad, user_agent, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        escaneoId,
        qrId,
        qr.producto_id,
        qr.tienda_id,
        qr.estado,
        qr.ciudad,
        req.headers['user-agent'],
        req.ip
    );
    
    // Redirigir a landing page
    res.redirect(qr.landing_path);
});

// Track WhatsApp click
app.post('/api/track/whatsapp', (req, res) => {
    const { producto_id, tienda_id, escaneo_id } = req.body;
    const id = uuidv4();
    
    db.prepare(`
        INSERT INTO whatsapp_clicks (id, escaneo_id, producto_id, tienda_id)
        VALUES (?, ?, ?, ?)
    `).run(id, escaneo_id, producto_id, tienda_id);
    
    res.json({ tracked: true });
});

// =====================
// API: ANALYTICS / DASHBOARD
// =====================

// Stats generales
app.get('/api/analytics/stats', (req, res) => {
    const { desde, hasta } = req.query;
    
    let dateFilter = '';
    const params = [];
    if (desde) {
        dateFilter = ' AND created_at >= ?';
        params.push(desde);
    }
    if (hasta) {
        dateFilter += ' AND created_at <= ?';
        params.push(hasta);
    }
    
    const totalEscaneos = db.prepare(`SELECT COUNT(*) as total FROM escaneos WHERE 1=1 ${dateFilter}`).get(...params);
    const totalWhatsapp = db.prepare(`SELECT COUNT(*) as total FROM whatsapp_clicks WHERE 1=1 ${dateFilter}`).get(...params);
    const totalProductos = db.prepare('SELECT COUNT(*) as total FROM productos').get();
    const totalTiendas = db.prepare('SELECT COUNT(*) as total FROM tiendas').get();
    const totalDistribuidores = db.prepare('SELECT COUNT(*) as total FROM distribuidores').get();
    
    res.json({
        escaneos: totalEscaneos.total,
        whatsapp_clicks: totalWhatsapp.total,
        conversion: totalEscaneos.total > 0 ? ((totalWhatsapp.total / totalEscaneos.total) * 100).toFixed(1) : 0,
        productos: totalProductos.total,
        tiendas: totalTiendas.total,
        distribuidores: totalDistribuidores.total
    });
});

// Escaneos por estado (para heat map)
app.get('/api/analytics/por-estado', (req, res) => {
    const stats = db.prepare(`
        SELECT 
            estado,
            COUNT(*) as escaneos,
            COUNT(DISTINCT tienda_id) as tiendas,
            (SELECT COUNT(*) FROM whatsapp_clicks w WHERE w.tienda_id IN (SELECT id FROM tiendas WHERE estado = e.estado)) as whatsapp
        FROM escaneos e
        WHERE estado IS NOT NULL
        GROUP BY estado
        ORDER BY escaneos DESC
    `).all();
    
    res.json(stats);
});

// Escaneos por día
app.get('/api/analytics/por-dia', (req, res) => {
    const { dias = 7 } = req.query;
    
    const stats = db.prepare(`
        SELECT 
            DATE(created_at) as fecha,
            COUNT(*) as escaneos,
            (SELECT COUNT(*) FROM whatsapp_clicks WHERE DATE(created_at) = DATE(e.created_at)) as whatsapp
        FROM escaneos e
        WHERE created_at >= DATE('now', '-${parseInt(dias)} days')
        GROUP BY DATE(created_at)
        ORDER BY fecha
    `).all();
    
    res.json(stats);
});

// Top productos
app.get('/api/analytics/top-productos', (req, res) => {
    const { limit = 10 } = req.query;
    
    const top = db.prepare(`
        SELECT 
            p.id,
            p.nombre,
            p.tipo,
            p.formato,
            p.imagen_url,
            COUNT(e.id) as escaneos,
            (SELECT COUNT(*) FROM whatsapp_clicks w WHERE w.producto_id = p.id) as whatsapp
        FROM productos p
        LEFT JOIN escaneos e ON e.producto_id = p.id
        GROUP BY p.id
        ORDER BY escaneos DESC
        LIMIT ?
    `).all(parseInt(limit));
    
    res.json(top);
});

// Top tiendas
app.get('/api/analytics/top-tiendas', (req, res) => {
    const { estado, limit = 10 } = req.query;
    
    let query = `
        SELECT 
            t.id,
            t.nombre,
            t.estado,
            t.ciudad,
            d.nombre as distribuidor,
            COUNT(e.id) as escaneos,
            (SELECT COUNT(*) FROM whatsapp_clicks w WHERE w.tienda_id = t.id) as whatsapp
        FROM tiendas t
        LEFT JOIN distribuidores d ON d.id = t.distribuidor_id
        LEFT JOIN escaneos e ON e.tienda_id = t.id
        WHERE 1=1
    `;
    const params = [];
    
    if (estado) {
        query += ' AND t.estado = ?';
        params.push(estado);
    }
    
    query += ' GROUP BY t.id ORDER BY escaneos DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const top = db.prepare(query).all(...params);
    res.json(top);
});

// Actividad reciente
app.get('/api/analytics/actividad-reciente', (req, res) => {
    const { limit = 20 } = req.query;
    
    const actividad = db.prepare(`
        SELECT 
            e.id,
            e.created_at,
            p.nombre as producto,
            p.formato,
            t.nombre as tienda,
            t.estado,
            t.ciudad,
            CASE WHEN w.id IS NOT NULL THEN 'whatsapp' ELSE 'escaneo' END as tipo
        FROM escaneos e
        LEFT JOIN productos p ON p.id = e.producto_id
        LEFT JOIN tiendas t ON t.id = e.tienda_id
        LEFT JOIN whatsapp_clicks w ON w.escaneo_id = e.id
        ORDER BY e.created_at DESC
        LIMIT ?
    `).all(parseInt(limit));
    
    res.json(actividad);
});

// =====================
// GENERADOR DE LANDING PAGE
// =====================

function generateLandingPage(producto, tienda, precio, promocion, qrId) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${producto.nombre} - Cesantoni Experience</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --cesantoni-green: #8BC34A;
            --cesantoni-dark: #1a1a1a;
            --cesantoni-gold: #C9A227;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Source Sans 3', sans-serif; background: #F5F3EF; min-height: 100vh; }
        .hero {
            background: linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%), 
                        ${producto.imagen_url ? `url(${producto.imagen_url})` : 'linear-gradient(135deg, #d4c4b0, #a89888)'};
            background-size: cover;
            background-position: center;
            min-height: 50vh;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            padding: 40px 20px;
            color: white;
        }
        .hero-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(255,255,255,0.15);
            backdrop-filter: blur(10px);
            padding: 8px 16px;
            border-radius: 30px;
            font-size: 0.85rem;
            margin-bottom: 16px;
            width: fit-content;
        }
        .hero h1 {
            font-family: 'Playfair Display', serif;
            font-size: 2.5rem;
            margin-bottom: 8px;
        }
        .hero p { font-size: 1.1rem; opacity: 0.9; }
        .promo-banner {
            background: linear-gradient(90deg, var(--cesantoni-gold), #d4af37);
            color: white;
            padding: 16px;
            text-align: center;
            font-weight: 600;
            ${!promocion ? 'display: none;' : ''}
        }
        .content { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
        .price-card {
            background: white;
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 16px;
        }
        .price-label { font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        .price-value { font-size: 2rem; font-weight: 700; color: var(--cesantoni-green); }
        .price-unit { font-size: 0.9rem; color: #888; }
        .whatsapp-btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            background: #25D366;
            color: white;
            padding: 14px 28px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: 600;
            box-shadow: 0 4px 15px rgba(37, 211, 102, 0.3);
            transition: transform 0.3s, box-shadow 0.3s;
        }
        .whatsapp-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(37, 211, 102, 0.4);
        }
        .specs-card {
            background: white;
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        .specs-card h2 {
            font-family: 'Playfair Display', serif;
            font-size: 1.3rem;
            margin-bottom: 20px;
            color: var(--cesantoni-dark);
        }
        .specs-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }
        .spec-item {
            background: #f8f8f8;
            padding: 14px;
            border-radius: 10px;
        }
        .spec-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
        .spec-value { font-weight: 600; color: var(--cesantoni-dark); margin-top: 4px; }
        .store-card {
            background: white;
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        .store-card h2 {
            font-family: 'Playfair Display', serif;
            font-size: 1.2rem;
            margin-bottom: 16px;
        }
        .store-row {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 12px;
            color: #444;
        }
        .store-row svg { color: var(--cesantoni-green); flex-shrink: 0; margin-top: 2px; }
        .floating-wa {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 56px;
            height: 56px;
            background: #25D366;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            box-shadow: 0 4px 15px rgba(37, 211, 102, 0.4);
            z-index: 100;
            text-decoration: none;
        }
        .footer {
            text-align: center;
            padding: 30px;
            color: #888;
        }
        .footer-logo { color: var(--cesantoni-green); font-family: 'Playfair Display', serif; font-size: 1.2rem; margin-bottom: 8px; }
    </style>
</head>
<body>
    <section class="hero">
        <span class="hero-badge">✨ ${producto.tipo || 'Cerámico Premium'}</span>
        <h1>${producto.nombre}</h1>
        <p>${producto.acabado || ''} • ${producto.formato || ''}</p>
    </section>
    
    ${promocion ? `<div class="promo-banner">🎉 ${promocion}</div>` : ''}
    
    <div class="content">
        <div class="price-card">
            <div>
                <div class="price-label">Precio por m²</div>
                <div class="price-value">$${precio.toLocaleString()} <span class="price-unit">MXN</span></div>
            </div>
            <a href="https://wa.me/${tienda.whatsapp?.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, me interesa el piso ${producto.nombre} que vi en ${tienda.nombre}. ¿Me pueden dar más información?`)}" 
               class="whatsapp-btn" onclick="trackWA()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Cotizar ahora
            </a>
        </div>
        
        <div class="specs-card">
            <h2>Especificaciones Técnicas</h2>
            <div class="specs-grid">
                <div class="spec-item">
                    <div class="spec-label">Formato</div>
                    <div class="spec-value">${producto.formato || 'N/A'}</div>
                </div>
                <div class="spec-item">
                    <div class="spec-label">Acabado</div>
                    <div class="spec-value">${producto.acabado || 'N/A'}</div>
                </div>
                <div class="spec-item">
                    <div class="spec-label">Uso</div>
                    <div class="spec-value">${producto.uso || 'Interior'}</div>
                </div>
                <div class="spec-item">
                    <div class="spec-label">Resistencia</div>
                    <div class="spec-value">${producto.resistencia || 'N/A'}</div>
                </div>
                <div class="spec-item">
                    <div class="spec-label">Piezas/Caja</div>
                    <div class="spec-value">${producto.piezas_caja || 'N/A'}</div>
                </div>
                <div class="spec-item">
                    <div class="spec-label">m²/Caja</div>
                    <div class="spec-value">${producto.m2_caja || 'N/A'}</div>
                </div>
            </div>
        </div>
        
        <div class="store-card">
            <h2>📍 Disponible en</h2>
            <div class="store-row">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5"/>
                </svg>
                <span><strong>${tienda.nombre}</strong><br>${tienda.distribuidor_nombre || ''}</span>
            </div>
            <div class="store-row">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                    <circle cx="12" cy="11" r="3"/>
                </svg>
                <span>${tienda.direccion || ''}<br>${tienda.ciudad}, ${tienda.estado}</span>
            </div>
            <div class="store-row">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                </svg>
                <span>${tienda.telefono || tienda.whatsapp || 'N/A'}</span>
            </div>
        </div>
        
        <a href="https://wa.me/${tienda.whatsapp?.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, me interesa el piso ${producto.nombre} que vi en ${tienda.nombre}. ¿Me pueden dar más información?`)}" 
           class="whatsapp-btn" style="width: 100%; justify-content: center;" onclick="trackWA()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Solicitar cotización por WhatsApp
        </a>
    </div>
    
    <footer class="footer">
        <div class="footer-logo">CESANTONI</div>
        <p>www.cesantoni.com.mx</p>
    </footer>
    
    <a href="https://wa.me/${tienda.whatsapp?.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, me interesa el piso ${producto.nombre}`)}" 
       class="floating-wa" onclick="trackWA()">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
    </a>
    
    <script>
        const QR_ID = '${qrId}';
        const PRODUCTO_ID = '${producto.id}';
        const TIENDA_ID = '${tienda.id}';
        
        function trackWA() {
            fetch('/api/track/whatsapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ producto_id: PRODUCTO_ID, tienda_id: TIENDA_ID })
            });
        }
    </script>
</body>
</html>`;
}

// =====================
// SEED DATA (datos de ejemplo)
// =====================

app.post('/api/seed', (req, res) => {
    // Crear productos de ejemplo
    const productos = [
        { nombre: 'Volterra', tipo: 'Muro Cerámico', formato: '30 x 60 cm Rectificado', acabado: 'Piedra Estructurado', uso: 'Interior, Baños, Cocina', resistencia: '≥ 120 kg', absorcion: '15-20%', piezas_caja: 8, m2_caja: 1.44, precio_base: 549 },
        { nombre: 'Carrara Blanco', tipo: 'Porcelanato', formato: '60 x 120 cm', acabado: 'Mármol Pulido', uso: 'Piso, Muro', resistencia: '≥ 200 kg', absorcion: '0.5%', piezas_caja: 2, m2_caja: 1.44, precio_base: 899 },
        { nombre: 'Nero Marquina', tipo: 'Porcelanato', formato: '45 x 90 cm', acabado: 'Mármol Negro', uso: 'Piso, Interior', resistencia: '≥ 180 kg', absorcion: '0.5%', piezas_caja: 3, m2_caja: 1.22, precio_base: 799 },
        { nombre: 'Travertino Gold', tipo: 'Piedra Natural', formato: '60 x 60 cm', acabado: 'Piedra Mate', uso: 'Piso, Exterior', resistencia: '≥ 150 kg', absorcion: '3%', piezas_caja: 4, m2_caja: 1.44, precio_base: 689 },
        { nombre: 'Onyx Honey', tipo: 'Porcelanato', formato: '80 x 160 cm', acabado: 'Ónix Brillante', uso: 'Muro, Interior', resistencia: '≥ 200 kg', absorcion: '0.5%', piezas_caja: 2, m2_caja: 2.56, precio_base: 1299 },
    ];
    
    productos.forEach(p => {
        const id = p.nombre.toLowerCase().replace(/\s+/g, '-');
        db.prepare(`
            INSERT OR REPLACE INTO productos (id, nombre, tipo, formato, acabado, uso, resistencia, absorcion, piezas_caja, m2_caja, precio_base)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, p.nombre, p.tipo, p.formato, p.acabado, p.uso, p.resistencia, p.absorcion, p.piezas_caja, p.m2_caja, p.precio_base);
    });
    
    // Crear distribuidores
    const distribuidores = [
        { id: 'interceramic', nombre: 'Interceramic', tipo: 'Tienda Especializada' },
        { id: 'home-depot', nombre: 'Home Depot', tipo: 'Home Center' },
        { id: 'porcelanite', nombre: 'Porcelanite', tipo: 'Showroom' },
        { id: 'lamosa', nombre: 'Lamosa', tipo: 'Distribuidor' },
    ];
    
    distribuidores.forEach(d => {
        db.prepare(`INSERT OR REPLACE INTO distribuidores (id, nombre, tipo) VALUES (?, ?, ?)`).run(d.id, d.nombre, d.tipo);
    });
    
    // Crear tiendas
    const tiendas = [
        { distribuidor_id: 'interceramic', nombre: 'Interceramic Polanco', estado: 'CDMX', ciudad: 'Ciudad de México', direccion: 'Av. Presidente Masaryk 456', whatsapp: '5215512345678' },
        { distribuidor_id: 'interceramic', nombre: 'Interceramic Zapopan', estado: 'Jalisco', ciudad: 'Zapopan', direccion: 'Av. Patria 1200', whatsapp: '5213312345678' },
        { distribuidor_id: 'home-depot', nombre: 'Home Depot Santa Fe', estado: 'CDMX', ciudad: 'Ciudad de México', direccion: 'Centro Comercial Santa Fe', whatsapp: '5215598765432' },
        { distribuidor_id: 'home-depot', nombre: 'Home Depot Monterrey', estado: 'Nuevo León', ciudad: 'Monterrey', direccion: 'Av. Revolución 2345', whatsapp: '5218112345678' },
        { distribuidor_id: 'porcelanite', nombre: 'Porcelanite GDL Centro', estado: 'Jalisco', ciudad: 'Guadalajara', direccion: 'Av. Vallarta 3456', whatsapp: '5213387654321' },
        { distribuidor_id: 'lamosa', nombre: 'Lamosa San Pedro', estado: 'Nuevo León', ciudad: 'San Pedro Garza García', direccion: 'Calzada del Valle 400', whatsapp: '5218198765432' },
    ];
    
    tiendas.forEach(t => {
        const id = t.nombre.toLowerCase().replace(/\s+/g, '-');
        db.prepare(`
            INSERT OR REPLACE INTO tiendas (id, distribuidor_id, nombre, estado, ciudad, direccion, whatsapp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, t.distribuidor_id, t.nombre, t.estado, t.ciudad, t.direccion, t.whatsapp);
    });
    
    // Generar escaneos de ejemplo
    const productoIds = productos.map(p => p.nombre.toLowerCase().replace(/\s+/g, '-'));
    const tiendaIds = tiendas.map(t => t.nombre.toLowerCase().replace(/\s+/g, '-'));
    const estados = ['CDMX', 'Jalisco', 'Nuevo León'];
    
    for (let i = 0; i < 500; i++) {
        const productoId = productoIds[Math.floor(Math.random() * productoIds.length)];
        const tiendaId = tiendaIds[Math.floor(Math.random() * tiendaIds.length)];
        const tienda = tiendas.find(t => t.nombre.toLowerCase().replace(/\s+/g, '-') === tiendaId);
        const daysAgo = Math.floor(Math.random() * 30);
        
        db.prepare(`
            INSERT INTO escaneos (id, producto_id, tienda_id, estado, ciudad, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now', '-${daysAgo} days', '-${Math.floor(Math.random() * 24)} hours'))
        `).run(uuidv4(), productoId, tiendaId, tienda?.estado, tienda?.ciudad);
    }
    
    // Generar whatsapp clicks (20% de los escaneos)
    const escaneos = db.prepare('SELECT id, producto_id, tienda_id FROM escaneos').all();
    escaneos.slice(0, Math.floor(escaneos.length * 0.2)).forEach(e => {
        db.prepare(`INSERT INTO whatsapp_clicks (id, escaneo_id, producto_id, tienda_id) VALUES (?, ?, ?, ?)`).run(uuidv4(), e.id, e.producto_id, e.tienda_id);
    });
    
    res.json({ message: 'Datos de ejemplo creados', productos: productos.length, tiendas: tiendas.length, escaneos: 500 });
});

// =====================
// INICIAR SERVIDOR
// =====================

// Crear directorios si no existen
['data/uploads', 'public/landings', 'public/qrcodes'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║         CESANTONI EXPERIENCE - CRM                        ║
║═══════════════════════════════════════════════════════════║
║  🚀 Servidor corriendo en: http://localhost:${PORT}          ║
║                                                           ║
║  📊 Dashboard:    http://localhost:${PORT}                   ║
║  🔌 API Base:     http://localhost:${PORT}/api               ║
║                                                           ║
║  Para iniciar con datos de ejemplo:                       ║
║  curl -X POST http://localhost:${PORT}/api/seed              ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
