// Generate video for product using Veo 3.1
import { writeFile } from 'fs/promises';
import 'dotenv/config';

const API_KEY = process.env.GOOGLE_API_KEY;

// Product to generate - edit these values
const PRODUCT = {
  id: 124,
  name: 'Romagni',
  slug: 'romagni',
  category: 'MÁRMOL',
  type: 'PORCELÁNICO RECTIFICADO',
  image: 'https://www.cesantoni.com.mx/wp-content/uploads/PORCALANTO_RENDER_ROMAGNI_80X160CM_4-896x1024.png'
};

// Generate unique description based on product
function getVoiceNarration(product) {
  const narrations = {
    'MADERA': `${product.name}. La belleza atemporal de la madera en porcelanato de alta resistencia. Tonos cálidos que transforman cualquier espacio. Cesantoni.`,
    'MÁRMOL': `${product.name}. La elegancia del mármol italiano en cada detalle. Vetas únicas que crean ambientes sofisticados. Cesantoni.`,
    'PIEDRA': `${product.name}. La fuerza de la piedra natural recreada con perfección. Texturas auténticas para espacios con carácter. Cesantoni.`,
    'CEMENTO': `${product.name}. El estilo industrial contemporáneo en su máxima expresión. Acabados urbanos para diseños modernos. Cesantoni.`,
    'DEFAULT': `${product.name}. Diseño excepcional y calidad premium. Superficies que inspiran. Cesantoni.`
  };
  return narrations[product.category] || narrations['DEFAULT'];
}

async function main() {
  console.log(`🎬 Generando video para ${PRODUCT.name}\n`);

  // Download image
  console.log('📥 Descargando imagen...');
  const imgResponse = await fetch(PRODUCT.image);
  if (!imgResponse.ok) {
    console.log('❌ Error descargando imagen:', imgResponse.status);
    return;
  }
  const imgBuffer = await imgResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imgBuffer).toString('base64');
  console.log('✅ Imagen:', Math.round(imageBase64.length / 1024), 'KB\n');

  // Build prompt
  const narration = getVoiceNarration(PRODUCT);
  const prompt = `Cinematic slow motion video with native audio. A warm female voice with Mexican Spanish accent narrates softly: "${narration}"

Gentle camera slowly pans across this elegant ${PRODUCT.category.toLowerCase()} look porcelain floor tile in a luxurious modern living room with warm natural lighting streaming through large windows. The camera moves smoothly, revealing the beautiful texture and grain. Soft piano music plays in background. Professional interior design photography style. High-end residential space. No people visible.`;

  const requestBody = {
    instances: [{
      prompt: prompt,
      image: {
        bytesBase64Encoded: imageBase64,
        mimeType: PRODUCT.image.includes('.png') ? 'image/png' : 'image/jpeg'
      }
    }],
    parameters: {
      aspectRatio: "16:9",
      sampleCount: 1
    }
  };

  console.log('🚀 Enviando a Veo 3.1 API...');
  console.log('Narración:', narration);
  console.log('');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }
  );

  const result = await response.json();

  if (result.error) {
    console.log('❌ Error:', result.error.message);
    return;
  }

  console.log('✅ Operación iniciada:', result.name);
  console.log('\n⏳ Esperando resultado (2-4 min)...\n');

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 15000)); // 15 seconds

    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${result.name}?key=${API_KEY}`
    );
    const op = await pollRes.json();

    const elapsed = (i + 1) * 15;
    console.log(`[${Math.floor(elapsed/60)}:${(elapsed%60).toString().padStart(2,'0')}] done:`, op.done || false);

    if (op.done) {
      const videoUri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;

      if (videoUri) {
        console.log('\n✅ VIDEO GENERADO!');
        console.log('📹 URI:', videoUri.substring(0, 80) + '...');

        // Download video
        console.log('\n📥 Descargando video...');
        const videoRes = await fetch(`${videoUri}&key=${API_KEY}`);
        const videoBuffer = await videoRes.arrayBuffer();

        const outputPath = `/tmp/${PRODUCT.slug}.mp4`;
        await writeFile(outputPath, Buffer.from(videoBuffer));
        console.log('✅ Video guardado en', outputPath);
        console.log('📊 Tamaño:', Math.round(videoBuffer.byteLength / 1024 / 1024 * 10) / 10, 'MB');

        console.log('\n🎉 Ahora sube a GCS con:');
        console.log(`gcloud storage cp ${outputPath} gs://cesantoni-videos/videos/${PRODUCT.slug}.mp4`);
        console.log('\nY actualiza la DB:');
        console.log(`UPDATE products SET video_url = 'https://storage.googleapis.com/cesantoni-videos/videos/${PRODUCT.slug}.mp4' WHERE id = ${PRODUCT.id};`);
      } else {
        console.log('❌ No se encontró video URI');
        console.log('Respuesta:', JSON.stringify(op, null, 2));
      }
      return;
    }
  }

  console.log('⏱️ Timeout después de 7.5 minutos');
}

main().catch(console.error);
