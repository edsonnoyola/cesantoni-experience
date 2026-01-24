const API_KEY = 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';

async function generateVideo() {
    console.log('🎬 Generando video con Veo 3 + Audio nativo...');
    
    const prompt = `Cinematic video with audio. Professional female Spanish narrator and elegant piano background music.

A camera slowly glides into a stunning contemporary living room at golden hour. The beautiful Alabama porcelain wood floor fills the frame, its rich grain texture catching warm sunlight streaming through floor-to-ceiling windows. Minimalist luxury furniture. No people.

The female narrator says in Spanish with a warm, sophisticated voice: "Imagina despertar cada día en un espacio que refleja tu esencia. Alabama, con sus veinte caras únicas, transforma tu hogar en una obra de arte. Durabilidad excepcional. Belleza atemporal. Cesantoni."

Soft elegant piano music plays in the background throughout.`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning?key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{ prompt: prompt }],
                    parameters: { 
                        aspectRatio: "16:9",
                        generateAudio: true
                    }
                })
            }
        );

        const result = await response.json();
        console.log('Resultado:', JSON.stringify(result, null, 2));
        
        if (result.name) {
            console.log('\n⏳ Espera 3-4 minutos y corre:');
            console.log(`curl 'https://generativelanguage.googleapis.com/v1beta/${result.name}?key=${API_KEY}'`);
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

generateVideo();
