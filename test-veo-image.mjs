// Test Veo 3.1 image-to-video
const API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';

const IMAGE_URL = 'https://www.cesantoni.com.mx/wp-content/uploads/PORCELANATO_BIANCO_MAGENTA_60X120CM_SALA-1024x1024.png';

async function main() {
  console.log('🎬 Test Veo 3.1 Image-to-Video\n');

  // 1. Download image
  console.log('📥 Descargando imagen...');
  const imgResponse = await fetch(IMAGE_URL);
  const imgBuffer = await imgResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imgBuffer).toString('base64');
  console.log('✅ Imagen descargada:', Math.round(imageBase64.length / 1024), 'KB\n');

  // 2. Build request
  const prompt = `Cinematic slow motion video. Camera slowly pans across this elegant marble porcelain floor tile in a luxury contemporary living room. Soft golden hour lighting. Professional interior photography. A warm female voice narrates in Spanish: "Bianco Magenta. La elegancia del mármol italiano. Cesantoni." Soft piano music.`;

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
  console.log('📡 Status:', response.status);

  if (result.error) {
    console.log('❌ Error:', result.error.message);
    return;
  }

  if (result.name) {
    console.log('✅ Operación iniciada:', result.name);
    console.log('\n⏳ Esperando resultado (polling cada 15s)...\n');

    // Poll for result
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 15000));

      const pollRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${result.name}?key=${API_KEY}`
      );
      const op = await pollRes.json();

      console.log(`[${i+1}/20] done:`, op.done || false);

      if (op.done) {
        console.log('\n✅ VIDEO GENERADO!');
        console.log('Operación completa:', JSON.stringify(op, null, 2));
        return;
      }
    }

    console.log('⏱️ Timeout - video aún en proceso');
  } else {
    console.log('❌ No se recibió operación:', JSON.stringify(result));
  }
}

main().catch(console.error);
