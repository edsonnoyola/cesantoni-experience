const XLSX = require('xlsx');
const { initDB, query, run } = require('./database');

// Mapeo de ciudades/abreviaturas a estados
const estadosPorCiudad = {
  'puebla': 'Puebla', 'villahermosa': 'Tabasco', 'chiapas': 'Chiapas', 'tuxtla': 'Chiapas',
  'monterrey': 'Nuevo León', 'guadalajara': 'Jalisco', 'zapopan': 'Jalisco', 'cdmx': 'CDMX',
  'toluca': 'Estado de México', 'queretaro': 'Querétaro', 'cancun': 'Quintana Roo',
  'merida': 'Yucatán', 'leon': 'Guanajuato', 'aguascalientes': 'Aguascalientes',
  'tijuana': 'Baja California', 'hermosillo': 'Sonora', 'chihuahua': 'Chihuahua',
  'saltillo': 'Coahuila', 'torreon': 'Coahuila', 'durango': 'Durango', 'culiacan': 'Sinaloa',
  'morelia': 'Michoacán', 'cuernavaca': 'Morelos', 'oaxaca': 'Oaxaca', 'veracruz': 'Veracruz',
  'tampico': 'Tamaulipas', 'san luis': 'San Luis Potosí', 'tab.': 'Tabasco', 'pue.': 'Puebla',
  'jal.': 'Jalisco', 'n.l.': 'Nuevo León', 'qro.': 'Querétaro', 'gto.': 'Guanajuato',
  'mich.': 'Michoacán', 'ver.': 'Veracruz', 'chis.': 'Chiapas', 'oax.': 'Oaxaca',
  'coah.': 'Coahuila', 'son.': 'Sonora', 'sin.': 'Sinaloa', 'dgo.': 'Durango',
  'ags.': 'Aguascalientes', 'zac.': 'Zacatecas', 'slp.': 'San Luis Potosí',
  'tamps.': 'Tamaulipas', 'hgo.': 'Hidalgo', 'tlax.': 'Tlaxcala', 'mor.': 'Morelos',
  'gro.': 'Guerrero', 'col.': 'Colima', 'nay.': 'Nayarit', 'b.c.': 'Baja California',
  'b.c.s.': 'Baja California Sur', 'camp.': 'Campeche', 'yuc.': 'Yucatán', 'q.roo': 'Quintana Roo'
};

function detectarEstado(ubicacion, estadoExplicito) {
  if (estadoExplicito) return estadoExplicito;
  const u = (ubicacion || '').toLowerCase();
  for (const [clave, estado] of Object.entries(estadosPorCiudad)) {
    if (u.includes(clave)) return estado;
  }
  return 'Por definir';
}

function limpiarTelefono(tel) {
  if (!tel) return null;
  let limpio = String(tel).replace(/[^0-9]/g, '');
  if (limpio.length === 10) limpio = '52' + limpio;
  return limpio || null;
}

async function importar() {
  await initDB();
  
  // Leer Excel - buscar en varias ubicaciones posibles
  let wb;
  const rutas = [
    './Base_de_datos_sucursales_Cesantoni.xlsx',
    process.env.HOME + '/Downloads/Base_de_datos_sucursales_Cesantoni.xlsx',
    process.env.HOME + '/Desktop/Base_de_datos_sucursales_Cesantoni.xlsx'
  ];
  
  for (const ruta of rutas) {
    try {
      wb = XLSX.readFile(ruta);
      console.log('📂 Excel encontrado en:', ruta);
      break;
    } catch (e) { continue; }
  }
  
  if (!wb) {
    console.log('❌ No encontré el Excel. Ponlo en la misma carpeta que este script.');
    console.log('   Nombre esperado: Base_de_datos_sucursales_Cesantoni.xlsx');
    process.exit(1);
  }
  
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log('\n📊 Filas en Excel:', data.length);
  
  // Extraer distribuidores únicos
  const distribuidores = [...new Set(data.map(r => r['NOMBRE COMERCIAL']).filter(Boolean))];
  console.log('🏢 Distribuidores encontrados:', distribuidores.length);
  
  // Crear distribuidores
  const distIds = {};
  for (const nombre of distribuidores) {
    const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const existente = query('SELECT id FROM distributors WHERE slug = ?', [slug]);
    
    if (existente.length > 0) {
      distIds[nombre] = existente[0].id;
      continue;
    }
    
    const resultado = run('INSERT INTO distributors (name, slug, active) VALUES (?, ?, 1)', [nombre, slug]);
    distIds[nombre] = resultado.lastInsertRowid;
    console.log('✅ Nuevo distribuidor:', nombre);
  }
  
  // Importar tiendas
  let importadas = 0;
  let saltadas = 0;
  
  for (const row of data) {
    const distribuidor = row['NOMBRE COMERCIAL'];
    if (!distribuidor || !distIds[distribuidor]) {
      saltadas++;
      continue;
    }
    
    const sucursal = row['SUCURSAL'] || 'Principal';
    const ubicacion = row['UBICACIÓN'] || '';
    const nombreTienda = (distribuidor + ' ' + sucursal).trim();
    const slug = nombreTienda.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    
    // Verificar si ya existe
    const existente = query('SELECT id FROM stores WHERE slug = ?', [slug]);
    if (existente.length > 0) {
      saltadas++;
      continue;
    }
    
    const estado = detectarEstado(ubicacion, row['ESTADO']);
    const ciudad = row['MUNICIPIO'] || '';
    const whatsapp = limpiarTelefono(row['TELEFONO']);
    const tipoTienda = row['TIPO DE TIENDA'] || '';
    
    run(`INSERT INTO stores (distributor_id, name, slug, state, city, address, whatsapp, promo_text, active) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [distIds[distribuidor], nombreTienda, slug, estado, ciudad, ubicacion, whatsapp, tipoTienda]);
    
    importadas++;
  }
  
  console.log('\n========================================');
  console.log('✅ Tiendas importadas:', importadas);
  console.log('⏭️  Tiendas saltadas:', saltadas);
  console.log('========================================');
  
  const totalDist = query('SELECT COUNT(*) as c FROM distributors')[0].c;
  const totalTiendas = query('SELECT COUNT(*) as c FROM stores')[0].c;
  console.log('\n📊 TOTALES EN BASE DE DATOS:');
  console.log('   Distribuidores:', totalDist);
  console.log('   Tiendas:', totalTiendas);
  console.log('');
}

importar().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
