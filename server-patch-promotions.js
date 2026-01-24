// =====================================================
// PATCH: PROMOCIONES Y MEJORAS
// =====================================================
// INSTRUCCIONES:
// 1. Abre server.js en un editor
// 2. Busca la línea: app.listen(PORT, () => {
// 3. ANTES de esa línea, pega todo este código
// =====================================================

// Crear tabla de promociones si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    product_id INTEGER,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'state', 'distributor', 'store')),
    scope_value TEXT,
    promo_price REAL NOT NULL,
    promo_text TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    until_stock INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);

// Agregar columnas a products si no existen
try { db.exec("ALTER TABLE products ADD COLUMN url TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE products ADD COLUMN image_url TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE products ADD COLUMN slug TEXT"); } catch(e) {}

console.log('✅ Tabla promotions lista');

// =====================================================
// API: PROMOCIONES
// =====================================================

// GET /api/promotions - Listar todas las promociones
app.get('/api/promotions', (req, res) => {
  try {
    const promotions = query(`
      SELECT p.*, pr.name as product_name, pr.sku as product_sku
      FROM promotions p
      LEFT JOIN products pr ON p.product_id = pr.id
      ORDER BY p.active DESC, p.end_date DESC
    `);
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/promotions/active - Solo promociones activas y vigentes
app.get('/api/promotions/active', (req, res) => {
  try {
    const now = new Date().toISOString();
    const promotions = query(`
      SELECT p.*, pr.name as product_name, pr.sku as product_sku
      FROM promotions p
      LEFT JOIN products pr ON p.product_id = pr.id
      WHERE p.active = 1 
        AND p.start_date <= ? 
        AND p.end_date >= ?
      ORDER BY p.scope_type DESC
    `, [now, now]);
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/promotions/for-product/:sku - Obtener promoción aplicable para un producto
app.get('/api/promotions/for-product/:sku', (req, res) => {
  try {
    const { sku } = req.params;
    const { store_slug, state, distributor } = req.query;
    const now = new Date().toISOString();
    
    // Buscar producto por SKU o slug
    let product = queryOne('SELECT * FROM products WHERE LOWER(sku) = LOWER(?)', [sku]);
    if (!product) {
      product = queryOne('SELECT * FROM products WHERE LOWER(slug) = LOWER(?)', [sku]);
    }
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    // Buscar promoción con prioridad: store > distributor > state > global
    let promotion = null;
    
    // 1. Buscar por tienda específica
    if (store_slug) {
      promotion = queryOne(`
        SELECT * FROM promotions 
        WHERE product_id = ? 
          AND scope_type = 'store' 
          AND scope_value = ?
          AND active = 1 
          AND start_date <= ? 
          AND end_date >= ?
      `, [product.id, store_slug, now, now]);
    }
    
    // 2. Buscar por distribuidor
    if (!promotion && distributor) {
      promotion = queryOne(`
        SELECT * FROM promotions 
        WHERE product_id = ? 
          AND scope_type = 'distributor' 
          AND scope_value = ?
          AND active = 1 
          AND start_date <= ? 
          AND end_date >= ?
      `, [product.id, distributor, now, now]);
    }
    
    // 3. Buscar por estado
    if (!promotion && state) {
      promotion = queryOne(`
        SELECT * FROM promotions 
        WHERE product_id = ? 
          AND scope_type = 'state' 
          AND scope_value = ?
          AND active = 1 
          AND start_date <= ? 
          AND end_date >= ?
      `, [product.id, state, now, now]);
    }
    
    // 4. Buscar global para este producto
    if (!promotion) {
      promotion = queryOne(`
        SELECT * FROM promotions 
        WHERE product_id = ? 
          AND scope_type = 'global'
          AND active = 1 
          AND start_date <= ? 
          AND end_date >= ?
      `, [product.id, now, now]);
    }
    
    res.json({
      product,
      promotion,
      final_price: promotion ? promotion.promo_price : product.base_price,
      has_promotion: !!promotion
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/promotions - Crear promoción
app.post('/api/promotions', (req, res) => {
  try {
    const { 
      name, 
      product_id, 
      scope_type, 
      scope_value, 
      promo_price, 
      promo_text,
      start_date, 
      end_date,
      until_stock 
    } = req.body;
    
    if (!name || !product_id || !scope_type || !promo_price || !start_date || !end_date) {
      return res.status(400).json({ error: 'Campos requeridos: name, product_id, scope_type, promo_price, start_date, end_date' });
    }
    
    const result = run(`
      INSERT INTO promotions (name, product_id, scope_type, scope_value, promo_price, promo_text, start_date, end_date, until_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, product_id, scope_type, scope_value || null, promo_price, promo_text || null, start_date, end_date, until_stock || 0]);
    
    res.status(201).json({ id: result.lastInsertRowid, message: 'Promoción creada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/promotions/:id - Actualizar promoción
app.put('/api/promotions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      product_id, 
      scope_type, 
      scope_value, 
      promo_price, 
      promo_text,
      start_date, 
      end_date,
      until_stock,
      active 
    } = req.body;
    
    run(`
      UPDATE promotions SET
        name = COALESCE(?, name),
        product_id = COALESCE(?, product_id),
        scope_type = COALESCE(?, scope_type),
        scope_value = ?,
        promo_price = COALESCE(?, promo_price),
        promo_text = ?,
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        until_stock = COALESCE(?, until_stock),
        active = COALESCE(?, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [name, product_id, scope_type, scope_value, promo_price, promo_text, start_date, end_date, until_stock, active, id]);
    
    res.json({ message: 'Promoción actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/promotions/:id - Eliminar promoción
app.delete('/api/promotions/:id', (req, res) => {
  try {
    run('DELETE FROM promotions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Promoción eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/promotions/:id/toggle - Activar/desactivar promoción
app.put('/api/promotions/:id/toggle', (req, res) => {
  try {
    run('UPDATE promotions SET active = NOT active, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    const promo = queryOne('SELECT * FROM promotions WHERE id = ?', [req.params.id]);
    res.json({ message: promo.active ? 'Promoción activada' : 'Promoción desactivada', active: promo.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// API: PRODUCTOS - Mejoras
// =====================================================

// PUT /api/products/bulk-price - Actualizar precios masivamente
app.put('/api/products/bulk-price', (req, res) => {
  try {
    const { product_ids, new_price, percentage_change } = req.body;
    
    if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ error: 'Se requiere array de product_ids' });
    }
    
    let updated = 0;
    
    if (new_price) {
      const placeholders = product_ids.map(() => '?').join(',');
      run(`UPDATE products SET base_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, [new_price, ...product_ids]);
      updated = product_ids.length;
    } else if (percentage_change) {
      const multiplier = 1 + (percentage_change / 100);
      const placeholders = product_ids.map(() => '?').join(',');
      run(`UPDATE products SET base_price = ROUND(base_price * ?, 2), updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, [multiplier, ...product_ids]);
      updated = product_ids.length;
    } else {
      return res.status(400).json({ error: 'Se requiere new_price o percentage_change' });
    }
    
    res.json({ message: `${updated} productos actualizados` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/states - Lista de estados con conteo de tiendas
app.get('/api/states', (req, res) => {
  try {
    const states = query(`
      SELECT state, COUNT(*) as store_count 
      FROM stores 
      WHERE state IS NOT NULL AND state != ''
      GROUP BY state 
      ORDER BY state
    `);
    res.json(states);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

console.log('✅ Endpoints de promociones listos');

// =====================================================
// FIN DEL PATCH
// =====================================================
