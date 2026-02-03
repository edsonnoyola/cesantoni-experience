// Generate video for Alpes
const API_KEY = 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';
const IMAGE_URL = 'https://www.cesantoni.com.mx/wp-content/uploads/tif_cesantoni_sku-12_c23-1-1024x768.png';
import { writeFile } from 'fs/promises';

async function main() {
  console.log('🎬 Generando video para ALPES\n');

  // Download image
  console.log('📥 Descargando imagen...');
  const imgResponse = await fetch(IMAGE_URL);
  const imgBuffer = await imgResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imgBuffer).toString('base64');
  console.log('✅ Imagen:', Math.round(imageBase64.length / 1024), 'KB\n');

  // Build prompt
  const prompt = `Cinematic slow motion video with native audio. A warm female voice with Mexican Spanish accent narrates: "Alpes. La majestuosidad de la piedra natural en porcelánico rectificado. Resistencia y elegancia para interiores y exteriores. Cesantoni."

Gentle camera pan across this elegant stone-look porcelain floor tile in a modern bathroom with natural lighting. Soft piano music in background. Professional interior photography. No people.`;

  const requestBody = {
    instances: [{
      prompt: prompt,
      image: {
        bytesBase64Encoded: imageBase64,
        mimeType: 'image/png'
      }
    }],
    parameters: {
      aspectRatio: "16:9",
      sampleCount: 1
    }
  };

  console.log('🚀 Enviando a Veo API...');
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

  console.log('✅ Operación:', result.name);
  console.log('\n⏳ Esperando resultado...\n');

  // Poll for result
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 15000));

    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${result.name}?key=${API_KEY}`
    );
    const op = await pollRes.json();

    console.log(`[${i+1}/25] done:`, op.done || false);

    if (op.done) {
      const videoUri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;

      if (videoUri) {
        console.log('\n✅ VIDEO GENERADO!');
        console.log('📹 URI:', videoUri);

        // Download video
        console.log('\n📥 Descargando video...');
        const videoRes = await fetch(`${videoUri}&key=${API_KEY}`);
        const videoBuffer = await videoRes.arrayBuffer();

        await writeFile('/tmp/alpes.mp4', Buffer.from(videoBuffer));
        console.log('✅ Video guardado en /tmp/alpes.mp4');
        console.log('📊 Tamaño:', Math.round(videoBuffer.byteLength / 1024 / 1024 * 10) / 10, 'MB');
      } else {
        console.log('Respuesta:', JSON.stringify(op, null, 2));
      }
      return;
    }
  }

  console.log('⏱️ Timeout');
}

main().catch(console.error);
