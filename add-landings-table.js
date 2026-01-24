const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'cesantoni.db'));

// Crear tabla landings
db.exec(`
    CREATE TABLE IF NOT EXISTS landings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        promo_text TEXT,
        promo_price REAL,
        video_url TEXT,
        image_url TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
    )
`);

console.log('✅ Tabla landings creada');

// Agregar endpoint al server para landings
const serverPatch = `
// ==================== LANDINGS API ====================

// GET all landings
app.get('/api/landings', (req, res) => {
    const landings = db.prepare(\`
        SELECT l.*, p.name as product_name, p.sku as product_sku, p.image_url as product_image
        FROM landings l
        JOIN products p ON l.product_id = p.id
        ORDER BY l.created_at DESC
    \`).all();
    res.json(landings);
});

// GET single landing
app.get('/api/landings/:id', (req, res) => {
    const landing = db.prepare(\`
        SELECT l.*, p.name as product_name, p.sku as product_sku, p.image_url as product_image
        FROM landings l
        JOIN products p ON l.product_id = p.id
        WHERE l.id = ?
    \`).get(req.params.id);
    if (!landing) return res.status(404).json({ error: 'Landing not found' });
    res.json(landing);
});

// CREATE landing
app.post('/api/landings', (req, res) => {
    const { product_id, title, description, promo_text, promo_price, video_url, image_url } = req.body;
    
    // Check if landing exists for this product
    const existing = db.prepare('SELECT id FROM landings WHERE product_id = ?').get(product_id);
    if (existing) {
        // Update existing
        db.prepare(\`
            UPDATE landings SET title=?, description=?, promo_text=?, promo_price=?, video_url=?, image_url=?, updated_at=CURRENT_TIMESTAMP
            WHERE product_id=?
        \`).run(title, description, promo_text, promo_price, video_url, image_url, product_id);
        res.json({ id: existing.id, updated: true });
    } else {
        // Create new
        const result = db.prepare(\`
            INSERT INTO landings (product_id, title, description, promo_text, promo_price, video_url, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        \`).run(product_id, title, description, promo_text, promo_price, video_url, image_url);
        res.json({ id: result.lastInsertRowid, created: true });
    }
});

// UPDATE landing
app.put('/api/landings/:id', (req, res) => {
    const { title, description, promo_text, promo_price, video_url, image_url, active } = req.body;
    db.prepare(\`
        UPDATE landings SET title=?, description=?, promo_text=?, promo_price=?, video_url=?, image_url=?, active=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
    \`).run(title, description, promo_text, promo_price, video_url, image_url, active ?? 1, req.params.id);
    res.json({ success: true });
});

// DELETE landing
app.delete('/api/landings/:id', (req, res) => {
    db.prepare('DELETE FROM landings WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// GET landing for product (used by landing.html)
app.get('/api/landings/by-product/:sku', (req, res) => {
    const landing = db.prepare(\`
        SELECT l.*, p.name as product_name, p.sku as product_sku, p.image_url as product_image,
               p.format, p.finish, p.type, p.usage, p.pieces_per_box, p.sqm_per_box, p.base_price
        FROM landings l
        JOIN products p ON l.product_id = p.id
        WHERE p.sku = ? OR p.slug = ?
    \`).get(req.params.sku, req.params.sku);
    if (!landing) return res.status(404).json({ error: 'Landing not found' });
    res.json(landing);
});
`;

const fs = require('fs');
const serverPath = path.join(__dirname, 'server.js');
let serverContent = fs.readFileSync(serverPath, 'utf8');

if (!serverContent.includes('/api/landings')) {
    // Insert before the last app.listen or at the end
    const insertPoint = serverContent.lastIndexOf('app.listen');
    if (insertPoint > -1) {
        serverContent = serverContent.slice(0, insertPoint) + serverPatch + '\n\n' + serverContent.slice(insertPoint);
    } else {
        serverContent += serverPatch;
    }
    fs.writeFileSync(serverPath, serverContent);
    console.log('✅ Endpoints de landings agregados al server');
} else {
    console.log('ℹ️ Endpoints de landings ya existen');
}

db.close();
console.log('✅ Listo. Reinicia el servidor.');
