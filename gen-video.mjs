const API_KEY = 'AIzaSyC6PfKqSaaYYqBwem0k7nd331aHeVxRm8Y';

async function generateVideo() {
    console.log('🎬 Generando video para Alabama con Veo...');
    
    const prompt = `Cinematic video: Camera slowly enters an elegant modern living room. 
    Beautiful Alabama porcelain wood floor visible throughout. 
    Natural sunlight streams through large windows, highlighting the rich wood grain texture.
    Slow, smooth camera movement. Luxury interior design aesthetic. 8K quality.`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${API_KEY}`,
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
        console.log('Resultado:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    }
}

generateVideo();
