import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const API_KEY = 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';

async function generateVideo(productName, imageUrl) {
    console.log('🎬 Generando video para:', productName);
    
    // Primero, leer la imagen y convertirla a base64
    const imagePath = imageUrl.replace('http://localhost:3000', './public');
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');
    
    const prompt = `Create a cinematic video of a luxury living room with this ${productName} porcelain wood floor. 
    Camera slowly enters the elegant space. Natural light through large windows highlights the wood grain texture. 
    Smooth, professional camera movement. High-end interior design aesthetic.`;

    // Usar Imagen 3 para generar la imagen del ambiente primero
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt: prompt }],
                parameters: { sampleCount: 1 }
            })
        }
    );

    const result = await response.json();
    console.log('Resultado:', JSON.stringify(result, null, 2));
    return result;
}

// Ejecutar
generateVideo('Alabama', 'http://localhost:3000/product-images/product_1.jpeg');
