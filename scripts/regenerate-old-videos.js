#!/usr/bin/env node
// Regenerate old videos that have text burned in
// These were generated before the prompt was fixed to only use camera movement
// Run: node scripts/regenerate-old-videos.js

require('dotenv').config();
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');

const API_KEY = process.env.GOOGLE_API_KEY;
const GCS_KEY_FILE = process.env.GCS_KEY_FILE || './gcs-credentials.json';
const GCS_BUCKET = process.env.GCS_BUCKET || 'cesantoni-videos';
const API_URL = process.env.BASE_URL || 'https://cesantoni-experience.onrender.com';

const storage = new Storage({ keyFilename: GCS_KEY_FILE });
const bucket = storage.bucket(GCS_BUCKET);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Product IDs with old videos that have text burned in
const OLD_VIDEO_IDS = [
  135, // Harlem
  219, // ATIS
  212, // BOTEV
  127, // Bianco Magenta
  123, // Bianco Quartz
  147, // Bottura Latte
  210, // CANNON WOOD
  155, // CORAL SHELL
  128, // Calacatta Black
  148, // Celle Blanc
  134, // Cotto Loreto
  207, // DAYTONA
  119, // Legacy Wood
  121, // Light Sandwood
  120, // Merlot Wood
  131, // Mutina Perlino
  137, // Península Oxford
  122, // Quarzo di Siena
  118, // Sunset Maple
];

function makeSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

async function downloadImage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function generateVideo(imgBase64, mimeType) {
  const body = {
    instances: [{
      prompt: 'Slow dolly forward camera movement. No changes to the scene.',
      image: { bytesBase64Encoded: imgBase64, mimeType }
    }],
    parameters: {
      aspectRatio: '16:9',
      sampleCount: 1,
      negativePrompt: 'text, letters, words, logos, watermarks, people'
    }
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const result = await resp.json();
  if (result.error) throw new Error(result.error.message);
  return result.name;
}

async function pollOperation(opName, maxPolls = 60) {
  for (let i = 0; i < maxPolls; i++) {
    await sleep(10000);
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${API_KEY}`);
    const result = await resp.json();
    if (result.done) {
      const samples = result.response?.generateVideoResponse?.generatedSamples;
      if (samples && samples.length > 0) return samples[0].video?.uri;
      throw new Error('No video in response');
    }
  }
  throw new Error('Timeout');
}

async function downloadVideo(uri) {
  const resp = await fetch(`${uri}&key=${API_KEY}`);
  if (!resp.ok) throw new Error(`Video download failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function uploadToGCS(videoBuffer, filename) {
  const tempPath = `/tmp/${filename}`;
  fs.writeFileSync(tempPath, videoBuffer);
  await bucket.upload(tempPath, {
    destination: `videos/${filename}`,
    metadata: { contentType: 'video/mp4', cacheControl: 'no-cache' }
  });
  fs.unlinkSync(tempPath);
  return `https://storage.googleapis.com/${GCS_BUCKET}/videos/${filename}`;
}

async function main() {
  const resp = await fetch(`${API_URL}/api/products`);
  const allProducts = await resp.json();
  const products = allProducts.filter(p => OLD_VIDEO_IDS.includes(p.id));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`REGENERANDO ${products.length} VIDEOS VIEJOS (con texto)`);
  console.log(`${'='.repeat(60)}`);

  let ok = 0, errors = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const gallery = JSON.parse(p.gallery || '[]');
    const renders = gallery.filter(g => /RENDER/i.test(g) && !/-150x/.test(g) && !/-300x/.test(g));
    const img = renders[0] || p.image_url;
    const mime = img.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const slug = makeSlug(p.name);

    console.log(`\n--- [${i + 1}/${products.length}] ${p.name} (${p.id}) ---`);

    try {
      console.log(`  📥 Descargando render...`);
      const imgBuffer = await downloadImage(img);
      const imgBase64 = imgBuffer.toString('base64');
      console.log(`  📊 Imagen: ${Math.round(imgBuffer.length / 1024)}KB`);

      console.log(`  🚀 Enviando a Veo 2.0...`);
      const opName = await generateVideo(imgBase64, mime);

      console.log(`  ⏳ Esperando video...`);
      const videoUri = await pollOperation(opName);

      console.log(`  📥 Descargando video...`);
      const videoBuffer = await downloadVideo(videoUri);

      console.log(`  ☁️  Subiendo a GCS...`);
      const gcsUrl = await uploadToGCS(videoBuffer, `${slug}.mp4`);

      console.log(`  💾 Actualizando DB...`);
      await fetch(`${API_URL}/api/products/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: gcsUrl + '?v=' + Date.now() })
      });

      console.log(`  ✅ LISTO: ${p.name}`);
      ok++;
    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}`);
      errors++;
    }

    if (i < products.length - 1) {
      console.log(`  ⏸️  Pausa 5s...`);
      await sleep(5000);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Regenerados: ${ok}`);
  console.log(`❌ Errores: ${errors}`);
}

main().catch(e => console.error('Fatal:', e));
