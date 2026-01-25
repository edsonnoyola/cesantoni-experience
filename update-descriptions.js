// update-descriptions.js
// Ejecutar: node update-descriptions.js

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'cesantoni.db'));

// Descripciones únicas e inspiradoras por producto
// Cada una evoca un estilo de vida, una emoción, un espacio
const descriptions = {
  // Maderas y tonos cálidos
  'ALABAMA': 'Alabama captura la calidez del roble americano en cada veta. Sus tonos miel crean ambientes acogedores donde la luz natural se funde con la elegancia rústica. Ideal para quienes buscan el abrazo reconfortante de la madera en su hogar.',
  
  'AMBERWOOD': 'Amberwood trae el encanto de los bosques otoñales a tu espacio. Sus matices ámbar y dorados evocan tardes junto a la chimenea, creando atmósferas de sofisticación cálida y atemporal.',
  
  'ANDREA': 'Andrea es la expresión de la elegancia contemporánea. Líneas limpias y tonos neutros que transforman cualquier habitación en un lienzo de posibilidades, donde tu estilo personal cobra vida.',
  
  'ARANZA': 'Aranza celebra la grandeza de los espacios abiertos. Su acabado pulido refleja la luz de manera sublime, creando ambientes luminosos que inspiran claridad y amplitud.',
  
  'ARDEM': 'Ardem fusiona la nobleza del mármol con la practicidad moderna. Vetas sutiles danzan sobre su superficie, contando historias de refinamiento que perduran generaciones.',
  
  'ASTOR': 'Astor es sinónimo de distinción atemporal. Inspirado en las grandes residencias europeas, ofrece un acabado que eleva cada paso a una experiencia de lujo cotidiano.',
  
  'ATIS': 'Atis representa la pureza del diseño minimalista. Su superficie mate absorbe la luz suavemente, creando espacios de serenidad donde cada momento invita a la contemplación.',
  
  'BASTILLE': 'Bastille evoca el romanticismo parisino en cada baldosa. Tonos grises sofisticados que recuerdan los bulevares de la Ciudad Luz, perfectos para espacios con personalidad cosmopolita.',
  
  'BENTO': 'Bento trae la armonía del diseño japonés a tu hogar. Geometrías precisas y colores equilibrados crean ambientes zen donde la calma y el orden reinan supremos.',
  
  'BRITTON': 'Britton captura la esencia de la campiña inglesa. Sus tonos tierra y texturas naturales evocan jardines centenarios y la elegancia discreta del countryside británico.',
  
  'DECKER': 'Decker es audacia y carácter en estado puro. Vetas pronunciadas y tonalidades profundas para quienes no temen hacer una declaración de estilo en cada rincón.',
  
  'DEVON': 'Devon susurra historias de costas rocosas y faros ancestrales. Su paleta de grises oceánicos trae la brisa marina y la calma del horizonte infinito a tu espacio.',
  
  'DUNDEE': 'Dundee celebra la herencia escocesa con dignidad. Tonos profundos y carácter robusto que evocan castillos de piedra y la nobleza de las Highlands.',
  
  'DURHAM': 'Durham es la síntesis perfecta entre tradición y modernidad. Acabados que honran el pasado mientras abrazan el futuro, para hogares que valoran ambas dimensiones.',
  
  'ESSEX': 'Essex destila sofisticación británica contemporánea. Líneas elegantes y acabados impecables que transforman espacios ordinarios en escenarios extraordinarios.',
  
  'EVEREST': 'Everest alcanza las cumbres del diseño premium. Tonos blancos impolutos con vetas grises que evocan las nieves eternas, para espacios que aspiran a lo sublime.',
  
  'FIRENZE': 'Firenze trae el Renacimiento italiano a tu hogar. Cada baldosa es un tributo a los maestros florentinos, donde el arte y la funcionalidad se encuentran en perfecta armonía.',
  
  'FLORENCIA': 'Florencia captura la luz dorada de la Toscana. Tonos terracota y acabados artesanales que transportan al corazón del arte y la belleza italiana.',
  
  'HAMPTON': 'Hampton evoca los veranos en la costa este americana. Blancos luminosos y acabados frescos que crean ambientes de elegancia relajada y sofisticación playera.',
  
  'HARVARD': 'Harvard es distinción académica hecha piso. Tonos nobles y acabados clásicos que inspiran ambientes de conocimiento, tradición y excelencia atemporal.',
  
  'IBIZA': 'Ibiza captura el espíritu mediterráneo en su máxima expresión. Blancos brillantes que reflejan el sol, creando espacios vibrantes llenos de energía y vida.',
  
  'KENT': 'Kent es la quintaesencia del estilo inglés. Texturas sutiles y colores serenos que evocan jardines de té y la elegancia discreta de la aristocracia británica.',
  
  'KINGSTON': 'Kingston combina fuerza y refinamiento. Tonos profundos con carácter distintivo para espacios que demandan presencia y personalidad inquebrantable.',
  
  'LANCASTER': 'Lancaster honra la grandeza de los palacios históricos. Acabados majestuosos que transforman cada habitación en una estancia digna de la realeza.',
  
  'LONDON': 'London es cosmopolita, vibrante y atemporal. Grises urbanos con personalidad que capturan la energía de una de las ciudades más icónicas del mundo.',
  
  'LYON': 'Lyon fusiona la gastronomía visual con el diseño. Tonos cremosos y texturas sedosas que crean ambientes donde cada momento se saborea con los ojos.',
  
  'MADRID': 'Madrid late con pasión y carácter. Tonos cálidos y vibrantes que evocan noches de flamenco y la alegría contagiosa del espíritu español.',
  
  'MALIBU': 'Malibu trae las olas del Pacífico a tu espacio. Acabados que capturan la luz californiana, creando ambientes de lujo relajado y estilo de vida costero.',
  
  'MANCHESTER': 'Manchester es industrial chic en su máxima expresión. Texturas urbanas y tonos contemporáneos para espacios que celebran la arquitectura moderna.',
  
  'MILANO': 'Milano es alta costura hecha piso. Acabados de pasarela que transforman cada espacio en un escenario de moda, diseño y vanguardia italiana.',
  
  'MONACO': 'Monaco es lujo sin disculpas. Acabados brillantes y tonos opulentos que evocan yates en el puerto, casinos legendarios y la dolce vita mediterránea.',
  
  'MONTECARLO': 'Montecarlo captura el glamour de la Riviera. Superficies que brillan como diamantes, creando espacios donde cada día es una celebración de la vida.',
  
  'NAPOLI': 'Napoli trae el alma del sur italiano a tu hogar. Colores vibrantes y texturas auténticas que evocan calles empedradas y la calidez del Mediterráneo.',
  
  'NEWCASTLE': 'Newcastle es fortaleza y carácter. Tonos de piedra ancestral que evocan murallas milenarias y la resistencia elegante del norte británico.',
  
  'OXFORD': 'Oxford es tradición académica y distinción intelectual. Acabados clásicos que inspiran espacios de reflexión, estudio y conversaciones trascendentes.',
  
  'PALERMO': 'Palermo fusiona culturas en cada baldosa. Patrones únicos que cuentan historias de conquistas y encuentros, creando espacios de riqueza visual incomparable.',
  
  'PARIS': 'Paris es romance eterno en cada detalle. Tonos suaves y acabados refinados que evocan cafés en Montmartre y paseos junto al Sena al atardecer.',
  
  'PORTOFINO': 'Portofino captura los colores del pueblo pesquero más elegante de Italia. Tonos que van del coral al terracota, para espacios llenos de vida mediterránea.',
  
  'PROVENCE': 'Provence trae los campos de lavanda a tu hogar. Tonos suaves y acabados naturales que evocan tardes soleadas en el sur de Francia.',
  
  'RICHMOND': 'Richmond es elegancia americana clásica. Acabados tradicionales con un toque contemporáneo, perfectos para hogares que valoran la herencia y el confort.',
  
  'ROMA': 'Roma es historia viva bajo tus pies. Acabados que evocan el Coliseo y el Foro, trayendo la grandeza del Imperio a los espacios modernos.',
  
  'SAHARA': 'Sahara captura la magia del desierto al atardecer. Tonos arena y dorados que crean ambientes cálidos de misterio y belleza infinita.',
  
  'SALZBURGO': 'Salzburgo es música clásica hecha diseño. Tonos elegantes que evocan salas de concierto y la sofisticación cultural de la Europa central.',
  
  'SANTORINI': 'Santorini trae el azul del Egeo y el blanco de las cúpulas a tu espacio. Ambientes frescos que evocan atardeceres griegos inolvidables.',
  
  'SEVILLA': 'Sevilla es pasión andaluza en cada baldosa. Patrones que recuerdan los azulejos del Alcázar, trayendo el arte mudéjar a la vida contemporánea.',
  
  'SIENA': 'Siena captura los tonos tierra de la Toscana medieval. Acabados que evocan plazas históricas y la belleza atemporal del campo italiano.',
  
  'STOCKHOLM': 'Stockholm es diseño escandinavo en estado puro. Líneas limpias, tonos claros y funcionalidad elegante para espacios de claridad nórdica.',
  
  'TOSCANA': 'Toscana trae los viñedos y cipreses a tu hogar. Tonos terracota y acabados rústicos que evocan villas centenarias y la dolce vita italiana.',
  
  'VALENCIA': 'Valencia es luz mediterránea y modernidad. Acabados vibrantes que capturan la energía de una ciudad que mira al futuro sin olvidar su herencia.',
  
  'VENECIA': 'Venecia es misterio y romance flotando sobre el agua. Tonos que evocan palacios reflejados en canales, creando espacios de ensueño y elegancia única.',
  
  'VERONA': 'Verona es amor eterno hecho piso. Tonos rosados y acabados románticos que evocan balcones de leyenda y promesas bajo las estrellas.',
  
  'VERSAILLES': 'Versailles es opulencia real sin límites. Acabados que honran el palacio más magnificente del mundo, para espacios que merecen ser palacios.',
  
  'VIENA': 'Viena es vals y elegancia imperial. Tonos nobles y acabados refinados que evocan palacios de los Habsburgo y noches de ópera inolvidables.',
  
  'WINDSOR': 'Windsor es realeza británica en cada detalle. Acabados majestuosos que evocan castillos centenarios y la tradición de la corona inglesa.',
  
  'YORK': 'York fusiona historia medieval con estilo contemporáneo. Tonos de piedra antigua que crean ambientes de carácter y profundidad temporal.',
  
  'ZURICH': 'Zurich es precisión suiza y lujo discreto. Acabados impecables y tonos sofisticados para espacios que valoran la perfección en cada detalle.'
};

// Descripciones genéricas por tipo de acabado para productos no listados
const finishDescriptions = {
  'MATE': 'con acabado mate que absorbe la luz suavemente, creando ambientes de serenidad y sofisticación contemporánea',
  'BRILLANTE': 'con acabado brillante que refleja la luz de manera sublime, amplificando la luminosidad y elegancia de cada espacio',
  'SATINADO': 'con acabado satinado que ofrece el balance perfecto entre brillo y suavidad, para ambientes de refinamiento equilibrado',
  'RUSTICO': 'con acabado rústico que celebra la autenticidad de los materiales naturales, trayendo calidez y carácter a tu hogar',
  'PULIDO': 'con acabado pulido de espejo que eleva cada espacio a niveles de lujo incomparable',
  'NATURAL': 'con acabado natural que honra la belleza inherente de los materiales, creando conexiones con la tierra'
};

const categoryPhrases = {
  'PISOS': 'Este piso de alta gama',
  'MUROS': 'Este revestimiento de muro premium',
  'EXTERIOR': 'Este piso de exterior resistente'
};

function generateDescription(product) {
  // Si tenemos descripción específica, usarla
  const specificDesc = descriptions[product.name.toUpperCase()];
  if (specificDesc) {
    return specificDesc;
  }
  
  // Generar descripción basada en características
  const category = categoryPhrases[product.category?.toUpperCase()] || 'Este revestimiento exclusivo';
  const finish = finishDescriptions[product.finish?.toUpperCase()] || 'con acabado de primera calidad';
  const format = product.format || '';
  
  const inspirations = [
    `${category} transforma espacios ordinarios en extraordinarios. ${product.name} ofrece una estética única ${finish}. Cada baldosa es una invitación a vivir rodeado de belleza y distinción.`,
    
    `${product.name} representa la fusión perfecta entre arte y funcionalidad. ${category} ${finish}, diseñado para quienes entienden que el verdadero lujo está en los detalles.`,
    
    `Descubre ${product.name}, donde la elegancia se encuentra con la durabilidad. ${category} ${finish}, creando ambientes que inspiran y perduran a través del tiempo.`,
    
    `${product.name} es más que un piso: es una declaración de estilo. ${category} ${finish}, perfecto para quienes buscan lo excepcional en cada rincón de su hogar.`
  ];
  
  // Seleccionar una inspiración basada en el hash del nombre
  const index = product.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % inspirations.length;
  return inspirations[index];
}

// Actualizar todas las descripciones
console.log('📝 Actualizando descripciones de productos...\n');

const products = db.prepare('SELECT id, name, category, format, finish FROM products').all();
const updateStmt = db.prepare('UPDATE products SET description = ? WHERE id = ?');

let updated = 0;
for (const product of products) {
  const newDesc = generateDescription(product);
  updateStmt.run(newDesc, product.id);
  console.log(`✅ ${product.name}: ${newDesc.substring(0, 60)}...`);
  updated++;
}

console.log(`\n🎉 ${updated} descripciones actualizadas`);
console.log('\nReinicia el servidor para ver los cambios:');
console.log('  pkill -f "node server" && node server.js');

db.close();
