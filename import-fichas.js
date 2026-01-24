const fs = require('fs');
const path = require('path');
const { initDB, query, run } = require('./database');

// Ruta correcta - Desktop
const FICHAS_FOLDER = '/Users/end/Desktop/Fichas_Tecnicas_Cesantoni';

async function importFichas() {
  await initDB();
  
  // Crear carpeta uploads si no existe
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
  }
  
  // Leer todos los PDFs
  const files = fs.readdirSync(FICHAS_FOLDER).filter(f => f.endsWith('.pdf'));
  console.log(`\n📁 Encontrados ${files.length} PDFs\n`);
  
  let imported = 0;
  let skipped = 0;
  
  for (const file of files) {
    const match = file.match(/Ficha_Tecnica_(.+)\.pdf/i);
    if (!match) {
      console.log(`⚠️  Saltando: ${file}`);
      skipped++;
      continue;
    }
    
    let name = match[1].replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/\(\d+\)/g, '').trim();
    const sku = name.toUpperCase().replace(/\s+/g, '-').substring(0, 20);
    
    let format = null;
    const formatMatch = name.match(/(\d+x\d+)/i);
    if (formatMatch) format = formatMatch[1] + 'cm';
    
    let finish = null;
    if (name.toLowerCase().includes('mate')) finish = 'Mate';
    else if (name.toLowerCase().includes('pulido')) finish = 'Pulido';
    
    let category = 'Piso';
    if (name.toLowerCase().includes('wood')) category = 'Madera';
    
    const exists = query('SELECT id FROM products WHERE sku = ?', [sku]);
    if (exists.length > 0) {
      skipped++;
      continue;
    }
    
    const srcPath = path.join(FICHAS_FOLDER, file);
    const destPath = path.join(__dirname, 'uploads', file);
    fs.copyFileSync(srcPath, destPath);
    
    run(`INSERT INTO products (sku, name, category, format, finish, pdf_url, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`, [sku, name, category, format, finish, `/uploads/${file}`]);
    
    console.log(`✅ ${name}`);
    imported++;
  }
  
  console.log(`\n✅ Importados: ${imported} | ⏭️ Saltados: ${skipped}`);
  const total = query('SELECT COUNT(*) as c FROM products');
  console.log(`🏷️  Total productos en BD: ${total[0].c}\n`);
}

importFichas().catch(console.error);
