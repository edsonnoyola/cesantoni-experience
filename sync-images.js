/**
 * SINCRONIZACIÓN DE IMÁGENES - Cesantoni CRM
 * Usa curl para requests más robustos a cesantoni.com.mx
 * Servidor debe estar corriendo en localhost:3000
 */

const { execSync } = require('child_process');
const fs = require('fs');

const API_BASE = 'http://localhost:3000';

// Fetch usando curl (más robusto para HTTPS)
function curlGet(url) {
  try {
    const result = execSync(`curl -sL -A "Mozilla/5.0" "${url}"`, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    return result;
  } catch (e) {
    return null;
  }
}

// Fetch JSON de API local
function fetchJson(url) {
  const result = curlGet(url);
  if (!result) return null;
  try {
    return JSON.parse(result);
  } catch (e) {
    return null;
  }
}

// Extraer imagen de página de producto de cesantoni.com.mx
function getCorrectImageFromWeb(productName) {
  // Crear slug
  const slug = productName.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  
  const url = `https://www.cesantoni.com.mx/producto/${slug}/`;
  const html = curlGet(url);
  
  if (!html || html.includes('Page not found') || html.length < 5000) {
    return null;
  }
  
  // Buscar TODAS las imágenes wp-content/uploads
  const allImages = html.match(/https:\/\/www\.cesantoni\.com\.mx\/wp-content\/uploads\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi);
  
  if (!allImages || allImages.length === 0) {
    return null;
  }
  
  // Crear slug para buscar renders específicos del producto
  const productSlug = productName.toUpperCase().replace(/\s+/g, '_');
  
  // Buscar renders que contengan el nombre del producto (mejor opción)
  const productRenders = allImages.filter(img => {
    const imgUpper = img.toUpperCase();
    return imgUpper.includes('RENDER') && imgUpper.includes(productSlug);
  });
  
  if (productRenders.length > 0) {
    // Preferir versión "scaled" o la más grande
    const scaled = productRenders.find(img => img.includes('-scaled.'));
    if (scaled) return scaled.replace(/\/\/+/g, '/').replace('https:/', 'https://');
    
    // Si no hay scaled, buscar HD
    const hd = productRenders.find(img => img.toUpperCase().includes('HD'));
    if (hd) return hd.replace(/\/\/+/g, '/').replace('https:/', 'https://');
    
    // Tomar la primera y quitar sufijos de tamaño
    return productRenders[0].replace(/-\d+x\d+\./, '.').replace(/\/\/+/g, '/').replace('https:/', 'https://');
  }
  
  // Si no hay render del producto, buscar cualquier render
  const anyRender = allImages.find(img => img.toUpperCase().includes('RENDER'));
  if (anyRender) {
    return anyRender.replace(/-\d+x\d+\./, '.').replace(/\/\/+/g, '/').replace('https:/', 'https://');
  }
  
  // Último recurso: primera imagen que no sea logo
  const notLogo = allImages.find(img => !img.includes('logo') && !img.includes('LOGO') && !img.includes('sombra'));
  if (notLogo) {
    return notLogo.replace(/-\d+x\d+\./, '.').replace(/\/\/+/g, '/').replace('https:/', 'https://');
  }
  
  return null;
}

// Comparar si dos URLs apuntan a la misma imagen
function isSameImage(url1, url2) {
  if (!url1 || !url2) return false;
  
  const normalize = (u) => u.split('?')[0].split('#')[0].toLowerCase().replace(/-\d+x\d+\./, '.');
  
  const n1 = normalize(url1);
  const n2 = normalize(url2);
  
  if (n1 === n2) return true;
  
  // Comparar nombres de archivo
  const file1 = n1.split('/').pop();
  const file2 = n2.split('/').pop();
  
  return file1 === file2;
}

// Actualizar producto via API
function updateProduct(id, imageUrl) {
  try {
    const cmd = `curl -sX PUT "${API_BASE}/api/products/${id}" -H "Content-Type: application/json" -d '{"image_url":"${imageUrl}"}'`;
    execSync(cmd, { encoding: 'utf8' });
    return true;
  } catch (e) {
    return false;
  }
}

async function syncImages() {
  console.log('\n🔄 SINCRONIZACIÓN DE IMÁGENES - Cesantoni CRM');
  console.log('='.repeat(60));
  
  // 1. Obtener productos del servidor
  console.log('\n📥 Obteniendo productos del servidor...');
  
  const products = fetchJson(`${API_BASE}/api/products`);
  if (!products) {
    console.error('❌ Error: No se puede conectar al servidor.');
    console.error('   Asegúrate de que el servidor esté corriendo: node server.js\n');
    process.exit(1);
  }
  
  console.log(`✅ ${products.length} productos encontrados\n`);
  
  // 2. Verificar cada producto
  const updates = [];
  const notFound = [];
  const correct = [];
  
  console.log('🔍 Verificando imágenes contra www.cesantoni.com.mx...\n');
  
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const progress = `[${(i+1).toString().padStart(3)}/${products.length}]`;
    process.stdout.write(`${progress} ${product.name.padEnd(25)} `);
    
    const correctImage = getCorrectImageFromWeb(product.name);
    
    if (!correctImage) {
      console.log('⚠️  No encontrado en web');
      notFound.push(product.name);
      continue;
    }
    
    if (isSameImage(product.image_url, correctImage)) {
      console.log('✅ OK');
      correct.push(product.name);
    } else {
      console.log('❌ DIFERENTE');
      updates.push({
        id: product.id,
        name: product.name,
        sku: product.sku,
        current: product.image_url,
        correct: correctImage
      });
    }
  }
  
  // 3. Resumen
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN\n');
  console.log(`   Total productos:    ${products.length}`);
  console.log(`   ✅ Correctos:       ${correct.length}`);
  console.log(`   ❌ A corregir:      ${updates.length}`);
  console.log(`   ⚠️  No encontrados:  ${notFound.length}`);
  
  if (notFound.length > 0 && notFound.length <= 15) {
    console.log('\n⚠️  Productos no encontrados en cesantoni.com.mx:');
    notFound.forEach(n => console.log(`   - ${n}`));
  }
  
  // 4. Aplicar correcciones
  if (updates.length > 0) {
    console.log('\n❌ PRODUCTOS CON IMAGEN INCORRECTA:\n');
    updates.forEach((u, i) => {
      console.log(`${i+1}. ${u.name} (${u.sku})`);
      console.log(`   Actual:   ${u.current || 'N/A'}`);
      console.log(`   Correcta: ${u.correct}\n`);
    });
    
    console.log('🔧 Aplicando correcciones...\n');
    
    let fixed = 0;
    for (const u of updates) {
      if (updateProduct(u.id, u.correct)) {
        console.log(`   ✅ ${u.name} - Actualizado`);
        fixed++;
      } else {
        console.log(`   ❌ ${u.name} - Error al actualizar`);
      }
    }
    
    console.log(`\n✅ ${fixed}/${updates.length} productos corregidos.`);
  } else if (correct.length === products.length) {
    console.log('\n✅ ¡Todas las imágenes están correctas!');
  }
  
  // 5. Guardar reporte
  const report = {
    date: new Date().toISOString(),
    summary: {
      total: products.length,
      correct: correct.length,
      updated: updates.length,
      notFound: notFound.length
    },
    updates: updates.map(u => ({
      name: u.name,
      sku: u.sku,
      oldImage: u.current,
      newImage: u.correct
    })),
    notFound: notFound
  };
  
  fs.writeFileSync('sync-report.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Reporte guardado en: sync-report.json\n');
}

// Ejecutar
syncImages().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
