#!/usr/bin/env node
// Regenerate ALL product videos with anti-text prompt
// Skips products already done (ALABAMA, AMBERWOOD, ARDEM)
// Run: node scripts/regenerate-all-videos.js

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

const SKIP_IDS = [221, 170, 214]; // ALABAMA, AMBERWOOD, ARDEM - already regenerated

const PROMPT = 'Slow cinematic dolly forward. No text, no words, no titles, no overlays. Only camera movement over the existing scene.';
const NEG_PROMPT = 'text, letters, words, titles, logos, watermarks, captions, subtitles, overlays, typography, writing, people, humans';

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
      prompt: PROMPT,
      image: { bytesBase64Encoded: imgBase64, mimeType }
    }],
    parameters: { aspectRatio: '16:9', sampleCount: 1, negativePrompt: NEG_PROMPT }
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

async function processProduct(p) {
  const slug = makeSlug(p.name);
  console.log(`\n🎬 ${p.name} (${p.id})`);

  try {
    // Find best render image
    const gallery = JSON.parse(p.gallery || '[]');
    const renders = gallery.filter(g => /RENDER/i.test(g) && !/-150x/.test(g) && !/-300x/.test(g));
    const img = renders[0] || p.image_url;
    const mime = img.endsWith('.png') ? 'image/png' : 'image/jpeg';

    console.log(`  📥 Descargando render...`);
    const imgBuffer = await downloadImage(img);
    console.log(`  📊 Imagen: ${Math.round(imgBuffer.length / 1024)}KB`);

    console.log(`  🚀 Enviando a Veo 2.0...`);
    const opName = await generateVideo(imgBuffer.toString('base64'), mime);

    console.log(`  ⏳ Esperando video...`);
    const videoUri = await pollOperation(opName);

    console.log(`  📥 Descargando video...`);
    const videoBuffer = await downloadVideo(videoUri);
    console.log(`  📊 Video: ${Math.round(videoBuffer.length / 1024)}KB`);

    console.log(`  ☁️  Subiendo a GCS...`);
    const gcsUrl = await uploadToGCS(videoBuffer, `${slug}.mp4`);

    console.log(`  💾 Actualizando DB...`);
    await fetch(`${API_URL}/api/products/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: gcsUrl + '?v=' + Date.now() })
    });

    console.log(`  ✅ LISTO: ${p.name}`);
    return 'ok';
  } catch (err) {
    console.log(`  ❌ ERROR: ${err.message}`);
    return 'error';
  }
}

async function main() {
  const resp = await fetch(`${API_URL}/api/products`);
  const allProducts = await resp.json();

  // ALL products except the 3 already regenerated
  const products = allProducts.filter(p => !SKIP_IDS.includes(p.id));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`REGENERANDO ${products.length} VIDEOS (prompt anti-texto)`);
  console.log(`Skipping: ALABAMA, AMBERWOOD, ARDEM (ya regenerados)`);
  console.log(`${'='.repeat(60)}`);

  let ok = 0, errors = 0;

  for (let i = 0; i < products.length; i++) {
    console.log(`\n--- [${i + 1}/${products.length}] ---`);
    const result = await processProduct(products[i]);
    if (result === 'ok') ok++;
    else errors++;

    console.log(`  📊 Progreso: ${ok} exitosos, ${errors} errores de ${i + 1} procesados`);

    if (i < products.length - 1) {
      console.log(`  ⏸️  Pausa 5s...`);
      await sleep(5000);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTADO FINAL`);
  console.log(`  ✅ Exitosos: ${ok}`);
  console.log(`  ❌ Errores: ${errors}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(e => console.error('Fatal:', e));
