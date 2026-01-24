#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

if (content.includes('/api/promotions')) {
  console.log('⚠️  Ya tiene endpoints de promociones');
  process.exit(0);
}

const patchCode = `
// =====================================================
// API: PROMOCIONES
// =====================================================

app.get('/api/promotions', (req, res) => {
  try {
    const promotions = query(\`
      SELECT p.*, pr.name as product_name, pr.sku as product_sku
      FROM promotions p
      LEFT JOIN products pr ON p.product_id = pr.id
      ORDER BY p.active DESC, p.end_date DESC
    \`);
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/promotions/active', (req, res) => {
  try {
    const now = new Date().toISOString();
    const promotions = query(\`
      SELECT p.*, pr.name as product_name, pr.sku as product_sku
      FROM promotions p
      LEFT JOIN products pr ON p.product_id = pr.id
      WHERE p.active = 1 AND p.start_date <= ? AND p.end_date >= ?
      ORDER BY p.scope_type DESC
    \`, [now, now]);
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/promotions/for-product/:sku', (req, res) => {
  try {
    const { sku } = req.params;
    const { store_slug, state, distributor } = req.query;
    const now = new Date().toISOString();
    
    let product = queryOne('SELECT * FROM products WHERE LOWER(sku) = LOWER(?)', [sku]);
    if (!product) product = queryOne('SELECT * FROM products WHERE LOWER(slug) = LOWER(?)', [sku]);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    
    let promotion = null;
    
    if (store_slug) {
      promotion = queryOne('SELECT * FROM promotions WHERE product_id = ? AND scope_type = ? AND scope_value = ? AND active = 1 AND start_date <= ? AND end_date >= ?', 
        [product.id, 'store', store_slug, now, now]);
    }
    if (!promotion && distributor) {
      promotion = queryOne('SELECT * FROM promotions WHERE product_id = ? AND scope_type = ? AND scope_value = ? AND active = 1 AND start_date <= ? AND end_date >= ?', 
        [product.id, 'distributor', distributor, now, now]);
    }
    if (!promotion && state) {
      promotion = queryOne('SELECT * FROM promotions WHERE product_id = ? AND scope_type = ? AND scope_value = ? AND active = 1 AND start_date <= ? AND end_date >= ?', 
        [product.id, 'state', state, now, now]);
    }
    if (!promotion) {
      promotion = queryOne('SELECT * FROM promotions WHERE product_id = ? AND scope_type = ? AND active = 1 AND start_date <= ? AND end_date >= ?', 
        [product.id, 'global', now, now]);
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

app.post('/api/promotions', (req, res) => {
  try {
    const { name, product_id, scope_type, scope_value, promo_price, promo_text, start_date, end_date, until_stock } = req.body;
    if (!name || !product_id || !scope_type || !promo_price || !start_date || !end_date) {
      return res.status(400).json({ error: 'Campos requeridos: name, product_id, scope_type, promo_price, start_date, end_date' });
    }
    const result = run('INSERT INTO promotions (name, product_id, scope_type, scope_value, promo_price, promo_text, start_date, end_date, until_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, product_id, scope_type, scope_value || null, promo_price, promo_text || null, start_date, end_date, until_stock || 0]);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Promoción creada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/promotions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, product_id, scope_type, scope_value, promo_price, promo_text, start_date, end_date, until_stock, active } = req.body;
    run('UPDATE promotions SET name=COALESCE(?,name), product_id=COALESCE(?,product_id), scope_type=COALESCE(?,scope_type), scope_value=?, promo_price=COALESCE(?,promo_price), promo_text=?, start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date), until_stock=COALESCE(?,until_stock), active=COALESCE(?,active), updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [name, product_id, scope_type, scope_value, promo_price, promo_text, start_date, end_date, until_stock, active, id]);
    res.json({ message: 'Promoción actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/promotions/:id', (req, res) => {
  try {
    run('DELETE FROM promotions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Promoción eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/promotions/:id/toggle', (req, res) => {
  try {
    run('UPDATE promotions SET active = NOT active, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    const promo = queryOne('SELECT * FROM promotions WHERE id = ?', [req.params.id]);
    res.json({ message: promo.active ? 'Activada' : 'Desactivada', active: promo.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/bulk-price', (req, res) => {
  try {
    const { product_ids, new_price, percentage_change } = req.body;
    if (!product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ error: 'Se requiere array de product_ids' });
    }
    const placeholders = product_ids.map(() => '?').join(',');
    if (new_price) {
      run(\`UPDATE products SET base_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (\${placeholders})\`, [new_price, ...product_ids]);
    } else if (percentage_change) {
      const multiplier = 1 + (percentage_change / 100);
      run(\`UPDATE products SET base_price = ROUND(base_price * ?, 2), updated_at = CURRENT_TIMESTAMP WHERE id IN (\${placeholders})\`, [multiplier, ...product_ids]);
    } else {
      return res.status(400).json({ error: 'Se requiere new_price o percentage_change' });
    }
    res.json({ message: \`\${product_ids.length} productos actualizados\` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

`;

// Insertar ANTES de "// =====================================================\n// INICIO"
const insertPoint = content.indexOf('// =====================================================\n// INICIO');
if (insertPoint === -1) {
  // Alternativa: buscar "async function start()"
  const altPoint = content.indexOf('async function start()');
  if (altPoint === -1) {
    console.log('❌ No encontré punto de inserción');
    process.exit(1);
  }
  content = content.slice(0, altPoint) + patchCode + '\n' + content.slice(altPoint);
} else {
  content = content.slice(0, insertPoint) + patchCode + '\n' + content.slice(insertPoint);
}

fs.writeFileSync(serverPath, content);
console.log('✅ Patch aplicado');
console.log('Reinicia: node server.js');
