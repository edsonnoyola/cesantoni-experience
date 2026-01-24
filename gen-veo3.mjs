const API_KEY = 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';

async function generateVideo() {
    console.log('🎬 Generando video con Veo 3 + Audio...');
    
    const prompt = `Cinematic video with professional female Spanish voiceover narration and elegant instrumental background music.

Scene: Camera slowly glides into a stunning contemporary Mexican living room at golden hour. 
The beautiful Alabama porcelain wood floor fills the frame, its rich grain texture catching warm sunlight streaming through floor-to-ceiling windows.

Female narrator (warm, sophisticated voice, Spanish): "Imagina despertar cada día en un espacio que refleja tu esencia. Alabama, con sus veinte caras únicas, transforma tu hogar en una obra de arte. Durabilidad excepcional, belleza atemporal."

Camera movement: Slow cinematic dolly forward, then gentle tilt down to showcase floor details.
Music: Soft piano and strings, elegant and minimal.
Mood: Luxurious, aspirational, warm.`;

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
                        personGeneration: "dont_allow"
                    }
                })
            }
        );

        const result = await response.json();
        console.log('Operación iniciada:', JSON.stringify(result, null, 2));
        console.log('\n⏳ Espera 2-3 minutos y corre:');
        console.log(`curl '${`https://generativelanguage.googleapis.com/v1beta/${result.name}?key=${API_KEY}`}'`);
    } catch (err) {
        console.error('Error:', err.message);
    }
}

generateVideo();
