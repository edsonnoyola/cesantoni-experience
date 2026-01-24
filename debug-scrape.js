/**
 * DEBUG - Verificar scraping de cesantoni.com.mx
 */

const { execSync } = require('child_process');

const testProducts = ['alabama', 'blendwood', 'denver', 'casablanca'];

console.log('🔍 DEBUG: Verificando scraping de cesantoni.com.mx\n');

for (const slug of testProducts) {
  const url = `https://www.cesantoni.com.mx/producto/${slug}/`;
  console.log(`\n📍 Probando: ${url}`);
  
  try {
    // Probar con curl
    const result = execSync(`curl -sL -A "Mozilla/5.0" "${url}" | head -c 500`, {
      encoding: 'utf8',
      timeout: 15000
    });
    
    console.log(`   Respuesta (primeros 500 chars):`);
    console.log(`   ${result.substring(0, 200).replace(/\n/g, ' ').trim()}...`);
    console.log(`   Longitud total: ${result.length} caracteres`);
    
    // Verificar si tiene contenido de producto
    if (result.includes('wp-content/uploads')) {
      console.log('   ✅ Contiene imágenes wp-content/uploads');
    } else {
      console.log('   ❌ NO contiene imágenes');
    }
    
    if (result.includes('404') || result.includes('Page not found')) {
      console.log('   ⚠️ Página 404');
    }
    
  } catch (e) {
    console.log(`   ❌ Error: ${e.message}`);
  }
}

console.log('\n\n📋 Verificando status HTTP:\n');

for (const slug of testProducts) {
  const url = `https://www.cesantoni.com.mx/producto/${slug}/`;
  try {
    const status = execSync(`curl -sI -o /dev/null -w "%{http_code}" "${url}"`, {
      encoding: 'utf8',
      timeout: 10000
    });
    console.log(`   ${slug}: HTTP ${status}`);
  } catch (e) {
    console.log(`   ${slug}: Error - ${e.message}`);
  }
}
