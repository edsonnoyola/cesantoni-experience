// Download video from Veo and save locally
import { writeFile } from 'fs/promises';

const API_KEY = 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';
const VIDEO_URI = 'https://generativelanguage.googleapis.com/v1beta/files/viwx76i0h619:download?alt=media';

async function downloadVideo() {
  console.log('📥 Descargando video de Veo...');

  const url = `${VIDEO_URI}&key=${API_KEY}`;
  console.log('URL:', url);

  const response = await fetch(url, {
    redirect: 'follow'
  });

  console.log('Status:', response.status);
  console.log('Headers:', Object.fromEntries(response.headers));

  if (response.ok) {
    const buffer = await response.arrayBuffer();
    console.log('Tamaño:', buffer.byteLength, 'bytes');

    await writeFile('/tmp/bianco-video.mp4', Buffer.from(buffer));
    console.log('✅ Video guardado en /tmp/bianco-video.mp4');
  } else {
    const text = await response.text();
    console.log('Error:', text);
  }
}

downloadVideo().catch(console.error);
