// Generate new video for Alabama
import { writeFile } from 'fs/promises';
import 'dotenv/config';

const API_KEY = process.env.GOOGLE_API_KEY;
const IMAGE_URL = 'https://www.cesantoni.com.mx/wp-content/uploads/Render_ALABAMA_Sala_2_HD-scaled.jpg';

async function main() {
  console.log('🎬 Generando NUEVO video para ALABAMA\n');

  // Download image
  console.log('📥 Descargando imagen...');
  const imgResponse = await fetch(IMAGE_URL);
  const imgBuffer = await imgResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imgBuffer).toString('base64');
  console.log('✅ Imagen:', Math.round(imageBase64.length / 1024), 'KB\n');

  // Build prompt - enhanced version
  const prompt = `Cinematic slow motion video with native audio. A warm female voice with Mexican Spanish accent narrates softly: "Alabama. La calidez del roble americano en cada veta. Tonos miel que crean ambientes acogedores. Cesantoni."

Gentle camera slowly pans across this elegant wood-look porcelain floor tile in a luxurious modern living room with warm natural lighting streaming through large windows. The camera moves smoothly, revealing the beautiful wood grain texture. Soft piano music plays in background. Professional interior design photography style. High-end residential space. No people visible.`;

  const requestBody = {
    instances: [{
      prompt: prompt,
      image: {
        bytesBase64Encoded: imageBase64,
        mimeType: 'image/jpeg'
      }
    }],
    parameters: {
      aspectRatio: "16:9",
      sampleCount: 1
    }
  };

  console.log('🚀 Enviando a Veo 3.1 API...');
  console.log('Prompt:', prompt.substring(0, 100) + '...\n');

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
  console.log('\n⏳ Esperando resultado (esto tarda 2-4 min)...\n');

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

        const outputPath = '/tmp/alabama_new.mp4';
        await writeFile(outputPath, Buffer.from(videoBuffer));
        console.log('✅ Video guardado en', outputPath);
        console.log('📊 Tamaño:', Math.round(videoBuffer.byteLength / 1024 / 1024 * 10) / 10, 'MB');

        console.log('\n🎉 Listo! Ahora sube a GCS con:');
        console.log('gcloud storage cp /tmp/alabama_new.mp4 gs://cesantoni-videos/videos/alabama.mp4');
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
