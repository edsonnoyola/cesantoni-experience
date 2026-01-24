/**
 * Agregar descripciones a productos Cesantoni
 * Genera texto premium basado en atributos técnicos
 */

const initSqlJs = require('sql.js');
const fs = require('fs');

const DB_PATH = './data/cesantoni.db';

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  
  console.log('🔧 Agregando columna description...\n');
  
  // Agregar columna si no existe
  try {
    db.run('ALTER TABLE products ADD COLUMN description TEXT');
    console.log('✅ Columna description agregada\n');
  } catch (e) {
    if (e.message.includes('duplicate column')) {
      console.log('ℹ️  Columna description ya existe\n');
    } else {
      throw e;
    }
  }
  
  // Obtener productos
  const products = db.exec(`
    SELECT id, name, category, format, finish, type, resistance, 
           water_absorption, mohs, usage, pieces_per_box, sqm_per_box
    FROM products
  `);
  
  if (!products[0]) {
    console.log('❌ No hay productos');
    return;
  }
  
  const cols = products[0].columns;
  const rows = products[0].values;
  
  console.log(`📦 Generando descripciones para ${rows.length} productos...\n`);
  
  let updated = 0;
  
  for (const row of rows) {
    const product = {};
    cols.forEach((col, i) => product[col] = row[i]);
    
    // Generar descripción premium
    const description = generateDescription(product);
    
    // Actualizar en DB
    db.run('UPDATE products SET description = ? WHERE id = ?', [description, product.id]);
    updated++;
    
    if (updated <= 5) {
      console.log(`✅ ${product.name}`);
      console.log(`   "${description.substring(0, 80)}..."\n`);
    }
  }
  
  // Guardar
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
  
  console.log(`\n✅ ${updated} productos actualizados con descripción`);
  console.log('💾 Base de datos guardada');
}

function generateDescription(p) {
  const name = p.name || 'Producto';
  const category = p.category || 'Porcelánico';
  const format = p.format || '';
  const finish = p.finish || '';
  const type = p.type || '';
  const usage = p.usage || '';
  const resistance = p.resistance || '';
  const mohs = p.mohs || '';
  const sqm = p.sqm_per_box || '';
  
  // Templates variados para no repetir
  const templates = [
    () => `${name} es un ${category.toLowerCase()} de alta gama que combina elegancia y durabilidad excepcional. ${finish ? `Su acabado ${finish.toLowerCase()} aporta sofisticación a cualquier espacio.` : ''} ${format ? `Formato ${format} ideal para proyectos residenciales y comerciales.` : ''} Diseñado para quienes buscan lo mejor en revestimientos premium.`,
    
    () => `Transforma tus espacios con ${name}, un ${category.toLowerCase()} premium que refleja calidad y diseño contemporáneo. ${type ? `Tipo ${type} con características superiores.` : ''} ${resistance ? `Resistencia ${resistance} garantiza durabilidad por años.` : ''} La elección perfecta para ambientes distinguidos.`,
    
    () => `${name} representa la excelencia en ${category.toLowerCase()}s de lujo. ${finish ? `Acabado ${finish.toLowerCase()} que realza la belleza natural.` : ''} ${usage ? `Perfecto para ${usage.toLowerCase()}.` : ''} Calidad Cesantoni respaldada por décadas de experiencia en el mercado mexicano.`,
    
    () => `Descubre ${name}, donde el diseño italiano se encuentra con la calidad mexicana. ${format ? `Formato ${format} versátil y elegante.` : ''} ${mohs ? `Dureza Mohs ${mohs} para máxima resistencia al desgaste.` : ''} Un revestimiento que eleva cualquier proyecto arquitectónico.`,
    
    () => `${name} combina tecnología de punta con diseño atemporal. ${category} premium con ${finish ? `acabado ${finish.toLowerCase()}` : 'características excepcionales'}. ${sqm ? `Rendimiento de ${sqm} m² por caja.` : ''} La solución ideal para espacios que demandan perfección.`
  ];
  
  // Seleccionar template basado en hash del nombre para consistencia
  const index = name.charCodeAt(0) % templates.length;
  let desc = templates[index]();
  
  // Limpiar espacios extra
  desc = desc.replace(/\s+/g, ' ').trim();
  
  return desc;
}

main().catch(console.error);
