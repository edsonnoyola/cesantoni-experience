/**
 * Migrar videos locales a Google Cloud Storage
 * Ejecutar: node scripts/migrate-videos-to-gcs.js
 */

const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const RENDER_API = process.env.RENDER_API || 'https://cesantoni-experience-za74.onrender.com';
const GCS_BUCKET = process.env.GCS_BUCKET || 'cesantoni-videos';
const VIDEOS_DIR = path.join(__dirname, '..', 'public', 'videos');

async function main() {
  console.log('=== Migración de Videos a Google Cloud Storage ===\n');

  // Initialize GCS
  let storage;
  if (process.env.GCS_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GCS_CREDENTIALS);
    storage = new Storage({ credentials });
  } else if (process.env.GCS_KEY_FILE) {
    storage = new Storage({ keyFilename: process.env.GCS_KEY_FILE });
  } else {
    console.error('❌ No hay credenciales de GCS configuradas');
    console.log('\nConfigura GCS_CREDENTIALS o GCS_KEY_FILE en .env');
    process.exit(1);
  }

  const bucket = storage.bucket(GCS_BUCKET);

  // Check if bucket exists
  try {
    const [exists] = await bucket.exists();
    if (!exists) {
      console.error(`❌ Bucket ${GCS_BUCKET} no existe`);
      process.exit(1);
    }
    console.log(`✅ Conectado a bucket: ${GCS_BUCKET}\n`);
  } catch (err) {
    console.error('❌ Error conectando a GCS:', err.message);
    process.exit(1);
  }

  // Get local videos
  const videos = fs.readdirSync(VIDEOS_DIR)
    .filter(f => f.endsWith('.mp4') && !f.startsWith('temp_'));

  console.log(`Videos locales encontrados: ${videos.length}\n`);

  // Get products from API
  const productsRes = await fetch(`${RENDER_API}/api/products`);
  const products = await productsRes.json();

  let uploaded = 0;
  let updated = 0;
  let errors = 0;

  for (const videoFile of videos) {
    const localPath = path.join(VIDEOS_DIR, videoFile);
    const destination = `videos/${videoFile}`;

    process.stdout.write(`📤 ${videoFile.padEnd(30)} `);

    try {
      // Upload to GCS
      await bucket.upload(localPath, {
        destination,
        metadata: {
          contentType: 'video/mp4',
          cacheControl: 'public, max-age=31536000'
        }
      });

      // Make public
      await bucket.file(destination).makePublic();

      const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${destination}`;
      uploaded++;

      // Find matching product and update
      const slug = videoFile.replace('.mp4', '').toLowerCase();
      const product = products.find(p => {
        const pSlug = (p.slug || p.name || '').toLowerCase().replace(/\s+/g, '_');
        return pSlug === slug || pSlug.includes(slug) || slug.includes(pSlug);
      });

      if (product && product.video_url && product.video_url.startsWith('/videos/')) {
        // Update product with GCS URL
        const updateRes = await fetch(`${RENDER_API}/api/products/${product.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_url: publicUrl })
        });

        if (updateRes.ok) {
          console.log(`✅ → ${product.name}`);
          updated++;
        } else {
          console.log(`⚠️ subido pero no actualizado`);
        }
      } else {
        console.log(`✅ (sin producto asociado)`);
      }

    } catch (err) {
      console.log(`❌ ${err.message}`);
      errors++;
    }

    // Small delay
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Subidos a GCS: ${uploaded}`);
  console.log(`Productos actualizados: ${updated}`);
  console.log(`Errores: ${errors}`);

  if (uploaded > 0 && errors === 0) {
    console.log('\n✅ Migración completada!');
    console.log('\nAhora puedes eliminar los videos locales de public/videos/');
    console.log('y quitarlos de git con: git rm public/videos/*.mp4');
  }
}

main().catch(console.error);
