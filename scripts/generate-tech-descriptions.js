#!/usr/bin/env node
// Generate unique technical descriptions for each product using Gemini
// Each description should read completely different - like BMW describes each model uniquely
require('dotenv').config();

const API_KEY = process.env.GOOGLE_API_KEY;
const API_URL = process.env.BASE_URL || 'https://cesantoni-experience.onrender.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function generateTechDescription(product, index) {
  const { name, category, format, finish, type, pei, water_absorption, mohs, usage, pieces_per_box, sqm_per_box } = product;

  // Build specs context
  const specs = [];
  if (format) specs.push(`Formato: ${format}`);
  if (finish) specs.push(`Acabado: ${finish}`);
  if (type) specs.push(`Tipo: ${type}`);
  if (pei) specs.push(`PEI: ${pei}`);
  if (water_absorption) specs.push(`Absorción agua: ${water_absorption}%`);
  if (mohs) specs.push(`Mohs: ${mohs}`);
  if (usage) specs.push(`Uso: ${usage}`);
  if (pieces_per_box) specs.push(`Piezas/caja: ${pieces_per_box}`);
  if (sqm_per_box) specs.push(`m²/caja: ${sqm_per_box}`);

  // Vary the style instruction based on index to force variety
  const styles = [
    'Escribe como si fuera una ficha de una revista de arquitectura.',
    'Escribe como un arquitecto explicándole a su cliente por qué eligió este piso.',
    'Escribe como el copy de un showroom de lujo europeo.',
    'Escribe como una recomendación personal de un experto en diseño interior.',
    'Escribe como si fuera la descripción de un catálogo de hotel boutique.',
    'Escribe como un diseñador que presenta este piso en una expo.',
    'Escribe como si estuvieras convenciendo a alguien que duda entre este y otro.',
    'Escribe como la ficha de un producto en una tienda online premium tipo Restoration Hardware.',
  ];
  const style = styles[index % styles.length];

  const prompt = `Eres copywriter de Cesantoni, marca de porcelanato premium en México. Escribe 2-3 oraciones (máximo 60 palabras) describiendo las características técnicas de este piso pero convertidas en BENEFICIOS que le importan al comprador.

Producto: ${name}
Categoría: ${category || 'Pisos'}
${specs.join('\n')}

${style}

Reglas:
- Traduce cada spec en un beneficio real: PEI alto = aguanta el uso diario, absorción baja = no le pasa nada con el agua, Mohs alto = no se raya, mate = no resbala, rectificado = se ve continuo, formato grande = menos juntas
- NO repitas frases genéricas como "alta calidad", "máximos estándares", "diseño exclusivo"
- NO uses las mismas frases para todos los pisos - cada uno debe leerse COMPLETAMENTE diferente
- Menciona el nombre del producto naturalmente si queda bien
- Si no hay specs, habla de la categoría (madera = calidez, mármol = elegancia, piedra = carácter, cemento = estilo urbano)
- Español, tono profesional pero cercano
- Solo devuelve la descripción, nada más`;

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0, maxOutputTokens: 200 }
    })
  });

  const result = await resp.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? text.trim().replace(/^["']|["']$/g, '') : null;
}

async function main() {
  console.log('Obteniendo productos...');
  const resp = await fetch(`${API_URL}/api/products`);
  const products = await resp.json();

  console.log(`${products.length} productos. Generando descripciones técnicas únicas...\n`);

  let updated = 0, errors = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`[${i + 1}/${products.length}] ${p.name}...`);

    try {
      const desc = await generateTechDescription(p, i);
      if (!desc) {
        console.log(`  ❌ Sin respuesta`);
        errors++;
        continue;
      }

      const updateResp = await fetch(`${API_URL}/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tech_description: desc })
      });

      if (updateResp.ok) {
        console.log(`  ✅ ${desc.substring(0, 90)}...`);
        updated++;
      } else {
        console.log(`  ❌ Error actualizando DB`);
        errors++;
      }
    } catch (err) {
      console.log(`  ❌ ${err.message}`);
      errors++;
    }

    // Rate limit: 15 RPM for Gemini
    if ((i + 1) % 14 === 0) {
      console.log('  ⏸️  Pausa 60s (rate limit)...');
      await sleep(60000);
    } else {
      await sleep(1000);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Actualizados: ${updated}`);
  console.log(`❌ Errores: ${errors}`);
}

main().catch(e => console.error('Fatal:', e));
