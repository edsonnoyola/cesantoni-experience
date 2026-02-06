# CESANTONI EXPERIENCE - Sistema QR + Video AI + Terra

## Versión 2.9.0 | 6 Febrero 2026

---

## Resumen Ejecutivo

Sistema completo para Cesantoni: landing pages premium, QR/NFC tracking, videos con IA, chat IA, y **Terra**: asistente de voz figital con Gemini TTS.

**Métricas:**
- 123 productos con datos enriquecidos y galerías
- 81 productos con specs técnicas completas
- 122 productos con productos relacionados
- 19 videos generados con IA (Veo 3.0/2.0)
- 407 tiendas con datos de contacto
- 16 distribuidores

**URLs:**
- **Producción:** https://cesantoni-experience.onrender.com
- **GitHub:** https://github.com/edsonnoyola/cesantoni-experience

---

## Estructura de Archivos

```
cesantoni-crm/
├── server.js                 # Backend principal (Express)
├── database.js               # Wrapper SQLite con sql.js
├── package.json              # Dependencias
├── .env                      # Variables de entorno
├── gcs-credentials.json      # Credenciales GCS (no en git)
├── data/
│   └── cesantoni.db          # Base de datos SQLite
├── public/
│   ├── index.html            # Dashboard principal
│   ├── landing.html          # Landing page premium
│   ├── terra.html            # Asistente de voz figital Terra
│   ├── comparar.html         # Comparador de productos
│   ├── favoritos.html        # Lista de favoritos
│   ├── qr-tiendas.html       # Generador de QRs
│   ├── nfc.html              # Gestor de NFC tags
│   ├── landings.html         # Gestor de landings
│   └── productos-edit.html   # Editor de productos
├── scripts/
│   ├── update-product-types.js
│   ├── add-related-products.js
│   └── migrate-videos-to-gcs.js
└── generate-alpes.mjs        # Ejemplo generación video
```

---

## Terra - Asistente de Voz Figital

### Que es
Asistente de voz en el celular del cliente. Funciona como "tu amiga experta en pisos" que te guia por la tienda fisica de Cesantoni. El cliente escanea un QR/NFC en cada piso y Terra le explica todo sobre ese producto.

### Estado actual: FUNCIONAL con detalles por pulir

### Que funciona
- Pantalla de bienvenida pide nombre del cliente
- **Auto-resume sesión**: si ya dio su nombre (24h), salta welcome al escanear nuevo producto
- Personalización: usa el nombre del cliente en toda la conversación
- Reconocimiento de voz (Web Speech API es-MX)
- Orbe animado gold/negro con imagen del producto
- Mini-card del producto con link a landing
- Knowledge base integrado: PEI, Mohs, absorción, acabados, limpieza, espacios, comparaciones
- Historial de conversación (últimos 6 mensajes) - Terra recuerda lo que dijiste
- Historial de productos visitados durante la sesión
- Resumen por WhatsApp con todos los productos vistos
- Sugerencias contextuales según producto
- Sonidos sutiles (Web Audio API)
- Fallback de texto para navegadores sin micrófono
- Auto-carga producto desde URL: `/terra?product=slug&store=tienda`
- **Escáner QR integrado**: botón en Terra abre cámara, escanea QR sin salir de la app
- **NFC auto-detección**: en Android Chrome, lee NFC tags automáticamente en background
- Personalidad "amiga experta": platicadora, hace preguntas, guía al cliente

### Voz - Gemini 2.5 Flash TTS
- Voz natural generada con Gemini 2.5 Flash TTS Preview (voz "Kore")
- Se llama via `/api/tts` endpoint separado
- Audio se reproduce en background (texto aparece primero)
- Fallback a Web Speech API si TTS no disponible
- **Requiere**: API key con permiso "Generative Language API" (ya configurado)

### Customer Journey en Tienda
1. Cliente escanea QR de entrada → Terra pide nombre (solo la primera vez)
2. Camina por la tienda → usa botón QR de Terra o acerca cel a NFC
3. Terra carga cada piso SIN salir de la app → lo presenta y platica
4. Cliente pregunta lo que quiera → Terra responde con knowledge base
5. Al final → resumen por WhatsApp con todos los pisos vistos

### Que falta / Issues conocidos
- Respuestas a veces se cortan (gemini-2.0-flash, 500 tokens, monitorear)
- Voz TTS tarda ~3-4 seg en generarse (texto aparece inmediato)
- Seguir iterando personalidad/tono
- Generar QR stickers per-producto para imprimir en tienda (qr-tiendas.html)
- Números de exhibición (display_number) no asignados todavía
- NFC no funciona en iPhone (limitación de Apple, usar QR scanner)
- BarcodeDetector API no disponible en Firefox/Safari (funciona en Chrome/Android)

### URLs de Terra
```
/terra                                    # Terra sin contexto
/terra?store=cesantoni-polanco            # Terra con tienda
/terra?product=alabama                    # Terra con producto (QR/NFC scan)
/terra?product=alabama&store=polanco      # Producto + tienda
```

### API Terra
```
POST /api/terra
Body: {
  message: string,
  customer_name: string,
  store_name: string,
  current_product_id: number,
  visited_products: string[],
  history: [{user: string, terra: string}]  // últimos 6
}
Response: { intent, speech, product, action }

POST /api/tts
Body: { text: string }
Response: { audioContent: base64_pcm, format: "pcm" }
Audio: PCM 24kHz 16-bit mono, se convierte a WAV en frontend
```

### Prompt de Gemini para Terra
- Personalidad: amiga experta, cálida, platicadora
- Knowledge base compacto: PEI, Mohs, absorción, acabados, espacios, limpieza, Cesantoni vs competencia
- Catálogo inteligente: solo productos de la misma categoría cuando hay producto actual
- Historial multi-turn: últimos 6 intercambios
- Respuestas: máx 40 palabras + pregunta
- Modelo: gemini-2.0-flash, temperature 0.8, maxOutputTokens 500

---

## Landing Page (/p/:slug)

### Que funciona
1. **Video Hero Fullscreen** - Video IA (Veo) o imagen, overlay gradiente, categoría, título, descripción
2. **Galería de Imágenes** - Grid responsive, lightbox con navegación (click, ←/→/Esc)
3. **Información del Producto** - Imagen con borde dorado, categoría, nombre, formato, descripción técnica, 4 mini-specs
4. **Beneficios** - 3 cards: Resistencia, Diseño, Garantía
5. **Especificaciones Técnicas** - Grid 8 specs con defaults inteligentes
6. **Productos Relacionados** - 4 productos misma categoría con links
7. **Información de Tienda** - Nombre, dirección, teléfono, mapa Google Maps
8. **WhatsApp CTA** - Botón flotante derecha, mensaje pre-formateado
9. **Chat IA** - Botón flotante izquierda, Gemini 2.0 Flash, 3 sugerencias, contexto producto+tienda

---

## API Endpoints

### Productos
```
GET    /api/products              # Lista todos
GET    /api/products/:id          # Detalle
PUT    /api/products/:id          # Actualizar
DELETE /api/products/:id/video    # Borrar video
GET    /api/products/:id/reviews  # Reviews del producto
```

### Tiendas
```
GET    /api/stores                # Lista tiendas
PUT    /api/stores/:id            # Actualizar tienda
GET    /api/distributors          # Lista distribuidores
```

### Videos
```
POST   /api/video/generate        # Generar con Veo 2.0/3.0
GET    /api/videos                # Lista videos
```

### Muestras, Cotizaciones, Reviews
```
POST   /api/samples               # Solicitar muestra
GET    /api/samples               # Lista solicitudes (admin)
PUT    /api/samples/:id           # Actualizar status
POST   /api/quotes                # Crear cotización
GET    /api/quotes                # Lista cotizaciones (admin)
POST   /api/reviews               # Crear review
```

### Analytics
```
POST   /api/scans                 # Registrar scan QR/NFC
GET    /api/analytics/by-source   # NFC vs QR stats
GET    /api/analytics/overview    # Métricas generales
```

---

## Base de Datos

### Tabla: products
```sql
id, sku, name, slug, description, category, format, finish,
type, pei, water_absorption, mohs, usage, image_url, video_url,
gallery, related_products, base_price, active, created_at, updated_at
```

### Tabla: stores
```sql
id, name, slug, distributor_id, distributor_name,
address, city, state, whatsapp, phone, email, lat, lng
```

### Tabla: sample_requests, quotes, reviews, scans
(Ver server.js para esquemas completos)

---

## Variables de Entorno

```
BASE_URL=https://cesantoni-experience.onrender.com
GOOGLE_API_KEY=AIza...           # Generative Language API (Gemini, Veo, TTS)
GCS_BUCKET=cesantoni-videos
GCS_CREDENTIALS={"type":"service_account",...}
NODE_ENV=production
```

**API Key restrictions:**
- Generative Language API: HABILITADA (Gemini, Terra, Chat, TTS)
- Cloud Text-to-Speech API: HABILITADA pero NO funciona con esta key
- Sin restricción de aplicación actualmente

---

## Changelog

### v2.9.0 (6 Feb 2026)
- **Terra - Mejoras de velocidad y personalidad**
  - Gemini 2.5 Flash TTS para voz natural (reemplaza Web Speech API)
  - Audio se carga en background, texto aparece inmediato
  - Knowledge base integrado: ceramicos, PEI, Mohs, absorcion, limpieza, espacios, instalacion
  - Auto-carga producto desde URL params (?product=slug) para QR/NFC
  - Historial de conversacion (6 mensajes) - Terra recuerda la platica
  - Personalidad "amiga experta": platicadora, hace preguntas, traduce tecnico a simple
  - Sugerencias contextuales segun producto (acabado, categoria, historial)
  - Catalogo inteligente: solo envia productos relevantes a Gemini
  - Fix orbe: imagen del producto contenida en circulo sin overflow

### v2.8.0 (5 Feb 2026)
- **Terra - Asistente de Voz Figital** (version inicial)
  - Interfaz de voz con orbe animado gold/negro
  - Web Speech API: reconocimiento y sintesis de voz en espanol mexicano
  - Gemini 2.0 Flash con catalogo completo de productos
  - Personalizacion por nombre, historial de visita, resumen WhatsApp
  - Sonidos sutiles con Web Audio API

- **Chat IA en Landing**
  - Boton flotante dorado en esquina inferior izquierda
  - Ventana de chat con sugerencias rapidas
  - Contexto de producto + tienda

### v2.7.0 (5 Feb 2026)
- Landing page premium rediseñada (video hero, galería, specs, relacionados)
- 123 productos con galerías, 81 con specs, 122 con relacionados
- 19 videos regenerados con Veo 3.0/2.0
- Mobile responsive optimizado

### v2.6.0 (3 Feb 2026)
- Endpoints backend: samples, quotes, reviews, promotions
- Chat IA backend con Gemini 2.0 Flash
- Tracking de scans QR/NFC con analytics

### v2.4.0 - v2.2.0
- Google Cloud Storage para videos
- Veo image-to-video, descripciones únicas
- Multi-select QR generator, editor de productos

---

## Soporte

**Repositorio:** https://github.com/edsonnoyola/cesantoni-experience
**Producción:** https://cesantoni-experience.onrender.com
