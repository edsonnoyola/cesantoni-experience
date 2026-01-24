/**
 * DEBUG v2 - Verificar contenido completo
 */

const { execSync } = require('child_process');

const slug = 'alabama';
const url = `https://www.cesantoni.com.mx/producto/${slug}/`;

console.log(`\n🔍 Probando: ${url}\n`);

try {
  // Obtener HTML completo (sin head)
  const html = execSync(`curl -sL -A "Mozilla/5.0" "${url}"`, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024 // 10MB buffer
  });
  
  console.log(`📏 Longitud HTML: ${html.length} caracteres\n`);
  
  // Buscar imágenes
  const imgMatches = html.match(/https:\/\/www\.cesantoni\.com\.mx\/wp-content\/uploads\/[^"'\s]+\.(jpg|jpeg|png|webp)/gi);
  
  if (imgMatches) {
    console.log(`✅ Encontradas ${imgMatches.length} imágenes:\n`);
    
    // Mostrar únicas
    const unique = [...new Set(imgMatches)];
    unique.slice(0, 10).forEach((img, i) => {
      console.log(`   ${i+1}. ${img}`);
    });
    
    // Buscar renders específicamente
    const renders = unique.filter(u => u.toLowerCase().includes('render'));
    if (renders.length > 0) {
      console.log(`\n🎯 Renders encontrados:`);
      renders.forEach(r => console.log(`   - ${r}`));
    }
  } else {
    console.log('❌ No se encontraron imágenes');
    console.log('\n📄 Primeros 2000 caracteres del HTML:');
    console.log(html.substring(0, 2000));
  }
  
} catch (e) {
  console.log(`❌ Error: ${e.message}`);
}
