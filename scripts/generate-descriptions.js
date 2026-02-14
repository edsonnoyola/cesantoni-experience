#!/usr/bin/env node
// Generate unique descriptions for all products using Gemini
require('dotenv').config();

const API_KEY = process.env.GOOGLE_API_KEY;
const API_URL = process.env.BASE_URL || 'https://cesantoni-experience-za74.onrender.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function generateDescription(product) {
  const { name, category, format, finish, type, pei, water_absorption, mohs, usage } = product;

  const prompt = `Eres el director creativo de Cesantoni, marca de porcelanato premium en México. Escribe una descripción aspiracional de 2-3 oraciones (máximo 50 palabras) para la landing page de un piso.

Producto: ${name}
Categoría: ${category || 'Piso'}
Formato: ${format || ''}
Acabado: ${finish || ''}
Uso: ${usage || 'Interior'}

Tu copy debe:
- Hacer que el lector SIENTA cómo se vería su hogar con este piso
- Evocar emociones: imagina la luz de la mañana sobre este piso, los pies descalzos, una cena con amigos
- Mencionar colores o texturas de forma poética (NO digas "formato 60x120 cm" ni "PEI 4")
- Ser como copy de Porcelanosa o revista AD México: elegante, sensorial, aspiracional
- NO uses: "alta gama", "declaración de estilo", "fusión perfecta", "evoca", "atemporal", "porcelánico"
- NO empieces con el nombre del producto
- Escribe en español
- Solo devuelve la descripción, nada más`;

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 150 }
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

  console.log(`${products.length} productos. Generando descripciones únicas...\n`);

  let updated = 0, errors = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`[${i + 1}/${products.length}] ${p.name}...`);

    try {
      const desc = await generateDescription(p);
      if (!desc) {
        console.log(`  ❌ Sin respuesta`);
        errors++;
        continue;
      }

      // Update via API
      const updateResp = await fetch(`${API_URL}/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc })
      });

      if (updateResp.ok) {
        console.log(`  ✅ ${desc.substring(0, 80)}...`);
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
