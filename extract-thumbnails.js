const fs = require('fs');
const path = require('path');
const pdf = require('pdf-poppler');
const { initDB, query, run } = require('./database');

const UPLOADS = path.join(__dirname, 'uploads');
const THUMBS = path.join(__dirname, 'public', 'thumbs');

async function extractThumbnails() {
  await initDB();
  
  // Crear carpeta thumbs
  if (!fs.existsSync(THUMBS)) {
    fs.mkdirSync(THUMBS, { recursive: true });
  }
  
  // Obtener productos con PDF
  const products = query("SELECT id, name, sku, pdf_url FROM products WHERE pdf_url IS NOT NULL");
  console.log(`\n📄 Procesando ${products.length} PDFs...\n`);
  
  let done = 0;
  let errors = 0;
  
  for (const p of products) {
    try {
      const pdfPath = path.join(__dirname, p.pdf_url);
      
      if (!fs.existsSync(pdfPath)) {
        console.log(`⚠️  No existe: ${p.name}`);
        errors++;
        continue;
      }
      
      const outputName = p.sku.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const outputPath = path.join(THUMBS, outputName);
      
      // Convertir primera página a imagen
      const opts = {
        format: 'jpeg',
        out_dir: THUMBS,
        out_prefix: outputName,
        page: 1,
        scale: 1024
      };
      
      await pdf.convert(pdfPath, opts);
      
      // El archivo se guarda como {prefix}-1.jpg
      const thumbFile = `${outputName}-1.jpg`;
      const thumbUrl = `/thumbs/${thumbFile}`;
      
      // Actualizar BD
      run('UPDATE products SET image_url = ? WHERE id = ?', [thumbUrl, p.id]);
      
      console.log(`✅ ${p.name}`);
      done++;
      
    } catch (e) {
      console.log(`❌ ${p.name}: ${e.message}`);
      errors++;
    }
  }
  
  console.log(`\n========================================`);
  console.log(`✅ Extraídos: ${done}`);
  console.log(`❌ Errores: ${errors}`);
  console.log(`========================================\n`);
}

extractThumbnails().catch(console.error);
