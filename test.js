const { GoogleGenAI } = require('@google/genai');
const client = new GoogleGenAI({ apiKey: 'AIzaSyCYqltyMcKiZmF-IZF4EOyeN1qRNSJlYxo' });
console.log('Client creado');
client.models.generateVideos({
  model: 'veo-3.1-generate-preview',
  prompt: 'Test sala moderna',
  config: { aspectRatio: '16:9' }
}).then(r => console.log('OK:', r.name)).catch(e => console.log('Error:', e.message));
