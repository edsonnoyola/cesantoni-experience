#!/usr/bin/env node
// Generate videos for all products without video
// Uses Veo 2.0 image-to-video with render as first frame
// Run: node scripts/generate-all-videos.js

require('dotenv').config();
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');

const API_KEY = process.env.GOOGLE_API_KEY;
const GCS_KEY_FILE = process.env.GCS_KEY_FILE || './gcs-credentials.json';
const GCS_BUCKET = process.env.GCS_BUCKET || 'cesantoni-videos';
const API_URL = process.env.BASE_URL || 'https://cesantoni-experience-za74.onrender.com';

const storage = new Storage({ keyFilename: GCS_KEY_FILE });
const bucket = storage.bucket(GCS_BUCKET);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

async function downloadImage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer);
}

async function generateVideo(imgBase64, mimeType) {
  const body = {
    instances: [{
      prompt: 'Slow cinematic dolly forward. No text, no words, no titles, no overlays. Only camera movement over the existing scene.',
      image: { bytesBase64Encoded: imgBase64, mimeType }
    }],
    parameters: {
      aspectRatio: '16:9',
      sampleCount: 1,
      negativePrompt: 'text, letters, words, titles, logos, watermarks, captions, subtitles, overlays, typography, writing, people, humans'
    }
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const result = await resp.json();
  if (result.error) throw new Error(result.error.message);
  return result.name; // operation name
}

async function pollOperation(opName, maxPolls = 60) {
  for (let i = 0; i < maxPolls; i++) {
    await sleep(10000);
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${API_KEY}`);
    const result = await resp.json();
    if (result.done) {
      const samples = result.response?.generateVideoResponse?.generatedSamples;
      if (samples && samples.length > 0) {
        return samples[0].video?.uri;
      }
      throw new Error('No video in response: ' + JSON.stringify(result.response || {}).substring(0, 200));
    }
  }
  throw new Error('Timeout waiting for video');
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

async function updateDB(productId, videoUrl) {
  const resp = await fetch(`${API_URL}/api/products/${productId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: videoUrl + '?v=' + Date.now() })
  });
  return resp.json();
}

async function processProduct(product) {
  const { id, name, img, mime } = product;
  const slug = product.slug || makeSlug(name);
  console.log(`\n🎬 ${name} (${id})`);

  try {
    // 1. Download render image
    console.log(`  📥 Descargando render...`);
    const imgBuffer = await downloadImage(img);
    const imgBase64 = imgBuffer.toString('base64');
    console.log(`  📊 Imagen: ${Math.round(imgBuffer.length / 1024)}KB`);

    // 2. Send to Veo 2.0
    console.log(`  🚀 Enviando a Veo 2.0...`);
    const opName = await generateVideo(imgBase64, mime);
    console.log(`  ⏳ Operación: ${opName}`);

    // 3. Poll for result
    console.log(`  ⏳ Esperando video...`);
    const videoUri = await pollOperation(opName);
    console.log(`  ✅ Video generado`);

    // 4. Download video
    console.log(`  📥 Descargando video...`);
    const videoBuffer = await downloadVideo(videoUri);
    console.log(`  📊 Video: ${Math.round(videoBuffer.length / 1024)}KB`);

    // 5. Upload to GCS
    console.log(`  ☁️  Subiendo a GCS...`);
    const gcsUrl = await uploadToGCS(videoBuffer, `${slug}.mp4`);
    console.log(`  ☁️  ${gcsUrl}`);

    // 6. Update DB
    console.log(`  💾 Actualizando DB...`);
    await updateDB(id, gcsUrl);
    console.log(`  ✅ LISTO: ${name}`);
    return { id, name, status: 'ok', url: gcsUrl };

  } catch (err) {
    console.log(`  ❌ ERROR: ${err.message}`);
    return { id, name, status: 'error', error: err.message };
  }
}

async function main() {
  // Fetch products from API
  const resp = await fetch(`${API_URL}/api/products`);
  const allProducts = await resp.json();
  const products = allProducts
    .filter(p => !p.video_url)
    .map(p => {
      const gallery = JSON.parse(p.gallery || '[]');
      const renders = gallery.filter(g => /RENDER/i.test(g) && !/-150x/.test(g) && !/-300x/.test(g));
      const img = renders[0] || p.image_url;
      return { id: p.id, name: p.name, slug: p.slug || makeSlug(p.name), img, mime: img.endsWith('.png') ? 'image/png' : 'image/jpeg' };
    });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`GENERANDO ${products.length} VIDEOS`);
  console.log(`${'='.repeat(60)}`);

  const results = { ok: 0, error: 0, errors: [] };

  // Process one at a time to avoid API rate limits
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`\n--- [${i + 1}/${products.length}] ---`);
    const result = await processProduct(p);

    if (result.status === 'ok') {
      results.ok++;
    } else {
      results.error++;
      results.errors.push(result);
    }

    // Brief pause between requests
    if (i < products.length - 1) {
      console.log(`  ⏸️  Pausa 5s...`);
      await sleep(5000);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTADO FINAL`);
  console.log(`  ✅ Exitosos: ${results.ok}`);
  console.log(`  ❌ Errores: ${results.error}`);
  if (results.errors.length) {
    console.log(`  Fallidos:`);
    results.errors.forEach(e => console.log(`    - ${e.name}: ${e.error}`));
  }
  console.log(`${'='.repeat(60)}`);
}

main().catch(e => console.error('Fatal:', e));
