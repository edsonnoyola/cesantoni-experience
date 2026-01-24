const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = 3001;
const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const LOGO_PATH = path.join(__dirname, 'public', 'logo-cesantoni.png');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/generate-video', async (req, res) => {
  const { productName, productDescription } = req.body;
  const videoId = Date.now();
  console.log('🎬 Video para:', productName);

  res.json({ success: true, videoId, message: 'Generando...' });

  try {
    // Prompt genérico sin tienda - video reutilizable para cualquier sucursal
    const prompt = `Video cinematográfico de interiores de lujo. Cámara entrando lentamente a una elegante sala contemporánea con piso de porcelanato efecto madera visible. Luz natural dorada entrando por ventanales. Movimiento de cámara suave tipo dolly. Una voz femenina cálida y profesional narra en español mexicano: "Imagina despertar cada día en un espacio que refleja tu esencia. ${productName}, ${productDescription}. Transforma tu hogar en una obra de arte." Música de fondo suave y elegante estilo piano. Sin texto en pantalla. Sin personas.`;

    console.log('📝 Generando video con Veo 3.1...');

    const result = await client.models.generateVideos({
      model: 'veo-3.1-generate-preview',
      prompt: prompt,
      config: { aspectRatio: '16:9' }
    });

    console.log('✅ Operación:', result.name);

    let videoUri = null;
    for (let i = 0; i < 30; i++) {
      await sleep(10000);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${result.name}?key=${process.env.GOOGLE_API_KEY}`);
      const op = await response.json();
      
      if (op.done) {
        videoUri = op.response.generateVideoResponse.generatedSamples[0].video.uri;
        console.log('✅ Video generado:', videoUri);
        break;
      }
      console.log(`🔍 Verificando... (${i+1}/30)`);
    }

    if (!videoUri) {
      console.log('⏰ Timeout');
      return;
    }

    const videosDir = path.join(__dirname, 'public', 'videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    const tempPath = path.join(videosDir, `temp_${videoId}.mp4`);
    const finalPath = path.join(videosDir, `${productName.toLowerCase().replace(/\s+/g, '_')}.mp4`);

    console.log('📥 Descargando video...');
    execSync(`curl -L -o "${tempPath}" "${videoUri}&key=${process.env.GOOGLE_API_KEY}"`);

    // Agregar logo PNG con overlay - esquina inferior derecha, escala 250px
    console.log('🎨 Agregando logo...');
    execSync(`${FFMPEG} -i "${tempPath}" -i "${LOGO_PATH}" -filter_complex "[1:v]scale=250:-1[logo];[0:v][logo]overlay=W-w-20:H-h-20" -c:a copy "${finalPath}" -y`);

    fs.unlinkSync(tempPath);

    const videoUrl = `/videos/${productName.toLowerCase().replace(/\s+/g, '_')}.mp4`;
    console.log('✅ Video listo:', videoUrl);

  } catch (error) {
    console.error('Error:', error.message);
  }
});

app.listen(PORT, () => console.log('🚀 Cesantoni Video Server en puerto ' + PORT));
