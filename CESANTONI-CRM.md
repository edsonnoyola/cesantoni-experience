# CESANTONI EXPERIENCE - CRM + Landing Pages + Video AI + Terra

## Versión 3.1.0 | 7 Febrero 2026

---

## Resumen Ejecutivo

Sistema completo para **Cesantoni Porcelanato Premium**: CRM con gestión de landings, landing pages de lujo para cada producto, generación de videos con IA (Veo 2.0), QR/NFC tracking para tiendas físicas, y **Terra**: asistente de voz figital con Gemini.

**Métricas:**
- 123 productos con datos enriquecidos y galerías scrapeadas de cesantoni.com.mx
- 123 descripciones únicas generadas con IA (Gemini 2.0 Flash, tono aspiracional/sensorial)
- 81 productos con specs técnicas completas (PEI, Mohs, absorción, etc.)
- 122 productos con productos relacionados
- 72 videos generados con IA (Veo 2.0) — **TODOS necesitan regeneración** con prompt anti-texto actualizado
- 51 productos sin video (pendientes por rate limit de Veo)
- 407 tiendas con datos de contacto y ubicación
- 16 distribuidores

**URLs:**
- **Producción:** https://cesantoni-experience.onrender.com
- **GitHub:** https://github.com/edsonnoyola/cesantoni-experience
- **CRM Dashboard:** https://cesantoni-experience.onrender.com/index.html
- **Generador QR:** https://cesantoni-experience.onrender.com/qr-tiendas.html
- **Editor Productos:** https://cesantoni-experience.onrender.com/productos-edit.html

---

## Estructura de Archivos

```
cesantoni-crm/
├── server.js                 # Backend principal (Express + SQLite)
├── database.js               # Wrapper SQLite con sql.js (in-memory)
├── package.json              # Dependencias
├── .env                      # Variables de entorno (no en git)
├── gcs-credentials.json      # Credenciales Google Cloud Storage (no en git)
├── data/
│   └── cesantoni.db          # Base de datos SQLite
├── public/
│   ├── index.html            # CRM Dashboard - Gestión de Landings
│   ├── landing.html          # Template landing page premium (una sola para todos los productos)
│   ├── terra.html            # Asistente de voz figital Terra
│   ├── comparar.html         # Comparador de productos
│   ├── favoritos.html        # Lista de favoritos del cliente
│   ├── qr-tiendas.html       # Generador de QRs por tienda
│   ├── nfc.html              # Gestor de NFC tags
│   ├── landings.html         # Gestor de landings (legacy)
│   ├── admin.html            # Admin (redirige a QR)
│   └── productos-edit.html   # Editor de productos
├── scripts/
│   ├── generate-all-videos.js     # Generación masiva de videos con Veo 2.0
│   ├── regenerate-old-videos.js   # Regenera 19 videos viejos con texto quemado
│   ├── generate-descriptions.js   # Genera descripciones únicas con Gemini
│   ├── update-product-types.js
│   ├── add-related-products.js
│   └── migrate-videos-to-gcs.js
└── generate-alpes.mjs        # Ejemplo generación video individual
```

---

## CRM - Dashboard (index.html)

### Qué es
Dashboard central para gestionar todas las landings de productos. Muestra métricas de cobertura (cuántos landings creados, cuántos con video, % cobertura), buscador, y acceso rápido a cada landing.

### Funcionalidades
- **Métricas en tiempo real**: Landings creados, Con video, Productos totales, % Cobertura
- **Lista de landings**: Cada producto aparece con su imagen, nombre, status de video
- **Búsqueda**: Filtrar por nombre
- **Crear Landing**: Botón para crear landing de un producto
- **Acceso directo**: Click en landing abre la landing page del producto

### Flujo completo del CRM
1. **Dashboard** (index.html) → ver todos los landings y métricas
2. **Editor de Productos** (productos-edit.html) → editar datos, galerías, specs, generar video
3. **Generador de QR** (qr-tiendas.html) → seleccionar productos + tiendas → generar PDF con QRs
4. **NFC Tags** (nfc.html) → gestionar tags NFC para productos en tienda

### URLs del CRM
```
/index.html           # Dashboard principal - Gestión de Landings
/qr-tiendas.html      # Generador de QR por tienda (selecciona productos + tiendas → PDF)
/productos-edit.html   # Editor de productos (datos, galería, specs, video)
/nfc.html             # Gestor de NFC tags
/admin.html           # Redirige a qr-tiendas.html
/landings.html        # Gestor de landings (legacy, usar index.html)
```

---

## Landing Page (/p/:slug y /landing/:slug)

### Qué es
Página de producto de lujo. Cada producto de Cesantoni tiene su propia landing accesible via `/p/{sku}` o `/landing/{slug}`. Todas usan el MISMO template (`public/landing.html`) que se llena dinámicamente con los datos del producto via API.

### Diseño y Estilo Visual
- **Estilo**: Lujo, premium (referencia: Porcelanosa, Cotto d'Este)
- **Colores**: Negro (#0a0a0a) fondo, Dorado (#C5A572) acentos, Blanco texto
- **Tipografía**: Serif elegante (Playfair Display) para títulos, Sans-serif (Inter) para cuerpo
- **Responsive**: Desktop, tablet, mobile optimizado

### Secciones (orden exacto de arriba a abajo)

1. **Header** - Logo Cesantoni izquierda, badge categoría (MÁRMOL, MADERA, etc.) derecha
2. **Video Hero Fullscreen (100vh)** - Video IA del piso ocupa toda la pantalla como fondo, overlay gradiente oscuro de abajo, badge categoría dorado, nombre del producto en tipografía serif grande, descripción del producto, flecha "DESCUBRE" que scrollea
3. **Galería de Imágenes** - Grid responsive con todas las fotos del producto (renders, close-ups, ambientes), click abre lightbox con navegación ←/→/Esc
4. **Información del Producto** - Imagen principal con borde dorado, categoría, nombre, formato (ej: 60x120cm), descripción técnica, 4 mini-specs destacados
5. **Beneficios** - 3 cards con iconos: Resistencia Superior, Diseño Exclusivo, Garantía Cesantoni
6. **Especificaciones Técnicas** - Grid de 8 specs: PEI, Absorción, Mohs, Formato, Acabado, Uso, Tipo, Resistencia
7. **Productos Relacionados** - 4 productos de la misma categoría con imagen y link a su landing
8. **Información de Tienda** - Si viene ?tienda= en URL: nombre, dirección, teléfono, mapa Google Maps
9. **WhatsApp CTA** - Botón flotante verde, esquina inferior derecha. Sube si hay botón Terra. Mensaje pre-formateado con nombre del producto
10. **Habla con Terra CTA** - Botón flotante dorado con ícono micrófono, esquina inferior derecha. Abre Terra en nueva pestaña pasando producto y tienda como contexto via URL params
11. **Chat IA** - Botón flotante izquierda (ícono chat), abre ventana de chat. Gemini 2.0 Flash con contexto del producto + tienda. 3 sugerencias rápidas

### URLs de Landing
```
/p/CES-ALABAMA                         # Landing por SKU
/p/alabama                              # Landing por slug
/landing/alabama                        # Landing por slug (ruta alternativa)
/p/calacatta-black                      # Landing de Calacatta Black
/p/botticelli?tienda=polanco            # Landing con info de tienda
/p/{slug}?tienda={store_slug}           # Formato general
/landing/{slug}?tienda={store_slug}     # Formato alternativo
```

### Cómo funciona técnicamente
1. `landing.html` lee el slug/sku del último segmento de la URL
2. Llama a `GET /api/landing/{identifier}` que busca por SKU o slug (case-insensitive)
3. Si viene `?tienda=`, llama a `GET /api/stores` y busca la tienda
4. Llena todas las secciones dinámicamente con JavaScript
5. Si `product.video_url` existe → carga video en el hero con autoplay, muted, loop
6. Si no hay video → muestra `image_url` como fondo estático del hero

---

## Descripciones de Producto - ESPECIFICACIÓN

### Estilo
Las descripciones son **aspiracionales y sensoriales**, estilo revista AD México / Porcelanosa. NO son técnicas.

### Generación
- **Script:** `node scripts/generate-descriptions.js`
- **Modelo:** Gemini 2.0 Flash, temperature 0.9
- **Longitud:** 2-3 oraciones, máximo 50 palabras

### Reglas del copy
- Hacer que el lector SIENTA cómo se vería su hogar con este piso
- Evocar emociones: luz de la mañana, pies descalzos, cena con amigos
- Mencionar colores o texturas de forma poética (NO specs técnicos)
- **Palabras PROHIBIDAS:** "alta gama", "declaración de estilo", "fusión perfecta", "evoca", "atemporal", "porcelánico"
- NO empezar con el nombre del producto
- Español

### Ejemplo bueno
> "Siente la calidez acogedora de un viñedo bajo tus pies. Merlot Wood: la textura profunda de la madera, inundada por la luz dorada de la tarde, crea un refugio donde cada momento se saborea con plenitud."

---

## Video Hero - ESPECIFICACIÓN CRÍTICA

### Qué debe ser
El video hero es **lo más importante** de la landing. Debe mostrar **exactamente el piso real del producto** instalado en un ambiente (sala, comedor, baño). El video es una animación del render/foto del producto con movimiento de cámara sutil.

### Cómo se genera el video

**Tecnología:** Google Veo 2.0 image-to-video via Gemini API

**Proceso paso a paso:**
1. Se toma la **imagen RENDER** del producto (foto que muestra el piso instalado en un cuarto/ambiente)
2. Se convierte a base64
3. Se envía a Veo 2.0 como primer frame con un prompt de movimiento de cámara
4. Veo anima esa imagen = video del cuarto con el piso moviéndose
5. Se descarga el video resultante
6. Se sube a Google Cloud Storage (GCS)
7. Se guarda la URL en `products.video_url`

**Prompt del video (OBLIGATORIO - anti-texto reforzado):**
```
Slow cinematic dolly forward. No text, no words, no titles, no overlays. Only camera movement over the existing scene.
```

**Negative prompt (OBLIGATORIO):**
```
text, letters, words, titles, logos, watermarks, captions, subtitles, overlays, typography, writing, people, humans
```

**Request body para Veo API:**
```json
{
  "instances": [{
    "prompt": "Slow cinematic dolly forward. No text, no words, no titles, no overlays. Only camera movement over the existing scene.",
    "image": {
      "bytesBase64Encoded": "<base64 del render del cuarto>",
      "mimeType": "image/jpeg"
    }
  }],
  "parameters": {
    "aspectRatio": "16:9",
    "sampleCount": 1,
    "negativePrompt": "text, letters, words, titles, logos, watermarks, captions, subtitles, overlays, typography, writing, people, humans"
  }
}
```

**Endpoint:**
```
POST https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key={API_KEY}
```

### Reglas OBLIGATORIAS del video
- El piso DEBE ser **exactamente** el mismo del producto (mismo color, patrón, vetas, formato, acabado)
- **NO** debe mostrar un piso genérico - debe ser fiel al render de referencia
- Movimiento de cámara: **dolly forward lento**, cinematográfico
- **SIN** texto, letras, logos, watermarks, títulos, overlays — **CERO texto en el video**
- **SIN** personas
- Iluminación suave y natural

### Errores comunes a EVITAR
- **NO usar `inlineData`** → Veo 2.0 no lo soporta, usar `bytesBase64Encoded`
- **NO usar `resizeMode`** → No soportado por Veo 2.0 via Gemini API
- **NO describir la escena en el prompt** → Solo describir movimiento de cámara. Si describes la escena, Veo inventa un cuarto genérico e ignora la imagen
- **NO usar la imagen C1 (close-up del piso suelto)** → Usar el RENDER del cuarto con el piso instalado
- **NO hacer fallback sin imagen** → Si falla con imagen, no reintentar sin imagen (genera video genérico basura)
- **NO poner el nombre del producto en el prompt** → Veo puede poner texto/letras en el video
- **Incluir "No text" en el prompt positivo** → El negative prompt solo NO es suficiente para evitar texto

### Selección de imagen para video
1. Buscar en `gallery` del producto una imagen con "RENDER" en el nombre (tamaño completo, no thumbnails -150x/-300x)
2. Si no hay, usar `image_url` principal del producto
3. La imagen DEBE mostrar el piso instalado en un ambiente/habitación

### Almacenamiento
- Videos en GCS: `gs://cesantoni-videos/videos/{slug}.mp4`
- URL pública: `https://storage.googleapis.com/cesantoni-videos/videos/{slug}.mp4`
- Agregar `?v={timestamp}` a la URL para cache-busting cuando se regenera

### Player de video en la landing
```javascript
// Hero video setup (landing.html)
const heroVideo = document.getElementById('hero-video');
heroSection.style.background = `url('${product.image_url}') center/cover`; // fallback
if (product.video_url) {
    heroVideo.poster = product.image_url;
    heroVideo.src = product.video_url;
    heroVideo.load();      // OBLIGATORIO después de set src dinámico
    heroVideo.play();      // OBLIGATORIO - autoplay no basta con src dinámico
}
```

### Scripts de generación de videos

**Generar videos para productos SIN video:**
```bash
node scripts/generate-all-videos.js
```

**Regenerar los 19 videos viejos con texto quemado:**
```bash
node scripts/regenerate-old-videos.js
```

**Regenerar TODOS los videos (limpiar video_url primero):**
Para regenerar todos, primero limpiar video_url de todos los productos y luego correr generate-all-videos.js.

- Rate limit de Veo: ~50 videos/día (puede variar)
- Cada video tarda ~2-5 minutos en generarse

### Sincronización de videos desde GCS
Al reiniciar Render, las video_url en la DB se pierden. El server tiene `syncVideosFromGCS()` que se ejecuta al arrancar:
1. Lista todos los archivos en `gs://cesantoni-videos/videos/`
2. Busca el producto correspondiente por slug
3. Si el producto no tiene video_url pero el .mp4 existe en GCS, lo asigna

### Bug conocido: video_url no se guarda en DB
A veces el video se sube a GCS exitosamente pero el UPDATE de `video_url` en la DB no persiste (Render free tier reinicia durante la generación larga). **Siempre verificar** que `video_url` no sea null después de generar. Si es null pero el video existe en GCS, actualizar manualmente via:
```bash
curl -X PUT "https://cesantoni-experience.onrender.com/api/products/{id}" \
  -H "Content-Type: application/json" \
  -d '{"video_url":"https://storage.googleapis.com/cesantoni-videos/videos/{slug}.mp4?v=1"}'
```

---

## Terra - Asistente de Voz Figital

### Qué es
Asistente de voz IA en el celular del cliente dentro de la tienda física. Funciona como **"tu amiga experta en pisos"** que te guía por la tienda. El cliente escanea un QR/NFC en cada piso y Terra le explica todo sobre ese producto con voz natural.

### Estado: FUNCIONAL

### Funcionalidades
- **Pantalla de bienvenida**: pide nombre del cliente (solo primera vez)
- **Auto-resume sesión**: si ya dio su nombre (24h), salta welcome al escanear nuevo producto
- **Personalización**: usa el nombre del cliente en toda la conversación
- **Reconocimiento de voz**: Web Speech API es-MX
- **Voz natural**: Gemini 2.5 Flash TTS (voz "Kore", español mexicano)
- **Orbe animado**: esfera gold/negro con imagen del producto al centro
- **Mini-card del producto**: nombre, imagen, link a landing
- **Knowledge base integrado**: PEI, Mohs, absorción, acabados, limpieza, espacios, comparaciones
- **Historial de conversación**: últimos 6 mensajes - Terra recuerda lo que dijiste
- **Historial de productos visitados**: todos los pisos que viste en la sesión
- **Resumen por WhatsApp**: al final envía un resumen con todos los productos vistos
- **Sugerencias contextuales**: según producto actual (acabado, categoría, uso)
- **Sonidos sutiles**: Web Audio API para feedback
- **Fallback de texto**: para navegadores sin micrófono
- **Escáner QR integrado**: botón en Terra abre cámara, escanea QR sin salir de la app
- **NFC auto-detección**: en Android Chrome, lee NFC tags automáticamente en background
- **Personalidad**: "amiga experta" - cálida, platicadora, hace preguntas, traduce técnico a simple

### Customer Journey en Tienda
1. Cliente llega a tienda → escanea **QR de entrada** → Terra pide nombre (solo primera vez)
2. Camina por la tienda → usa **botón QR de Terra** o acerca celular a **NFC tag**
3. Terra carga cada piso **sin salir de la app** → lo presenta y platica sobre él
4. Cliente **pregunta lo que quiera** → Terra responde con knowledge base completo
5. Al final → **resumen por WhatsApp** con todos los pisos vistos + links a landings

### Voz - Gemini 2.5 Flash TTS
- Voz natural generada con Gemini 2.5 Flash TTS Preview (voz "Kore")
- Endpoint separado: `POST /api/tts`
- Audio se reproduce en background (texto aparece primero, no espera audio)
- Fallback a Web Speech API si TTS no disponible
- Audio: PCM 24kHz 16-bit mono → se convierte a WAV en frontend

### Prompt de Gemini para Terra
- **Personalidad**: amiga experta, cálida, platicadora
- **Knowledge base**: PEI, Mohs, absorción, acabados, espacios, limpieza, Cesantoni vs competencia
- **Catálogo inteligente**: solo envía productos de la misma categoría cuando hay producto actual
- **Historial multi-turn**: últimos 6 intercambios
- **Respuestas**: máx 40 palabras + pregunta
- **Modelo**: gemini-2.0-flash, temperature 0.8, maxOutputTokens 500

### URLs de Terra
```
/terra                                    # Terra sin contexto
/terra?store=cesantoni-polanco            # Terra con tienda
/terra?product=alabama                    # Terra con producto (desde QR/NFC)
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
```

### Issues conocidos de Terra
- Respuestas a veces se cortan (monitorear maxOutputTokens)
- Voz TTS tarda ~3-4 seg en generarse (texto aparece inmediato)
- NFC no funciona en iPhone (limitación de Apple, usar QR scanner)
- BarcodeDetector API no disponible en Firefox/Safari (funciona en Chrome/Android)

---

## API Endpoints

### Productos
```
GET    /api/products              # Lista todos (con gallery, specs, video_url)
GET    /api/products/:id          # Detalle de un producto
PUT    /api/products/:id          # Actualizar producto (nombre, video_url, etc.)
DELETE /api/products/:id/video    # Borrar video de un producto
GET    /api/products/:id/reviews  # Reviews del producto
GET    /api/landing/:identifier   # Busca producto por SKU o slug (case-insensitive)
```

### Landings
```
GET    /api/landings              # Lista todos los landings (JOIN con products)
POST   /api/landings              # Crear landing (o actualizar si ya existe para ese product_id)
PUT    /api/landings/:id          # Actualizar landing
DELETE /api/landings/:id          # Borrar landing
```

### Tiendas
```
GET    /api/stores                # Lista 407 tiendas
PUT    /api/stores/:id            # Actualizar tienda
GET    /api/distributors          # Lista 16 distribuidores
```

### Videos
```
POST   /api/video/generate        # Generar video con Veo 2.0 (async, responde inmediato)
GET    /api/videos                # Lista videos locales
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

## Base de Datos (SQLite via sql.js)

### Tabla: products
```sql
id, sku, name, slug, description, category, format, finish,
type, pei, water_absorption, mohs, usage, image_url, video_url,
gallery (JSON array de URLs), related_products (JSON array de IDs),
base_price, active, created_at, updated_at
```

### Tabla: landings
```sql
id, product_id (FK → products.id), title, description, promo_text,
video_url, image_url, active, created_at, updated_at
```

### Tabla: stores
```sql
id, name, slug, distributor_id, distributor_name,
address, city, state, whatsapp, phone, email, lat, lng
```

### Tabla: sample_requests, quotes, reviews, scans
(Ver server.js para esquemas completos)

---

## Variables de Entorno (.env)

```
BASE_URL=https://cesantoni-experience.onrender.com
GOOGLE_API_KEY=AIza...           # Generative Language API (Gemini, Veo, TTS)
GCS_BUCKET=cesantoni-videos      # Bucket de Google Cloud Storage
GCS_KEY_FILE=./gcs-credentials.json  # Service account para GCS
NODE_ENV=production
```

**API Key permisos:**
- Generative Language API: HABILITADA (Gemini para Terra/Chat, Veo para videos, TTS para voz)
- La misma key sirve para todo (Terra, Chat, Video, TTS)

---

## Deploy y Hosting

- **Hosting**: Render.com (free tier)
- **Deploy**: Auto-deploy desde GitHub main branch
- **Tiempo de deploy**: ~3-5 minutos
- **Spin down**: Server se duerme tras inactividad, primer request tarda ~30s en despertar
- **DB**: SQLite in-memory (sql.js) - se recarga desde archivo en cada restart
- **Videos**: Google Cloud Storage (persistente, no se pierde en restart)
- **Sync automático**: `syncVideosFromGCS()` al arrancar recupera video_url de GCS
- **Dominio**: cesantoni-experience.onrender.com

---

## Pendientes / TODO

- [ ] **Regenerar TODOS los 72 videos** con prompt anti-texto actualizado (Veo genera texto en videos)
- [ ] **Generar 51 videos faltantes** (rate limit de Veo alcanzado)
- [ ] Total: ~123 videos por generar/regenerar cuando se resetee cuota de Veo
- [ ] Repoblar tabla landings (se pierden con restart de Render, considerar persistencia)

---

## Changelog

### v3.1.0 (7 Feb 2026)
- **Ruta /landing/:slug** agregada (además de /p/:sku)
- **Prompt anti-texto reforzado** para Veo 2.0:
  - Prompt positivo: "No text, no words, no titles, no overlays"
  - Negative prompt expandido: typography, writing, captions, subtitles, etc.
- **Script regenerate-old-videos.js** para regenerar 19 videos con texto quemado
- **123 descripciones regeneradas** con tono aspiracional/sensorial (Gemini 2.0 Flash)
  - Estilo: Porcelanosa / AD México, poético, emocional
  - Prohibido: specs técnicos, "alta gama", "fusión perfecta", "atemporal"
- **Script generate-descriptions.js** para regeneración masiva de descripciones

### v3.0.0 (6 Feb 2026)
- **Generación masiva de videos con Veo 2.0 image-to-video**
  - 72 videos generados usando render del cuarto como primer frame
  - Prompt mínimo: solo movimiento de cámara (dolly forward)
  - Fix formato: bytesBase64Encoded (no inlineData) para Gemini API
  - Script `generate-all-videos.js` para generación en lote
- **Landing page mejorada**
  - Botón "Habla con Terra" dorado con ícono micrófono
  - Fix video hero: load() + play() para autoplay dinámico
  - Video hero muestra el piso exacto del producto (no genérico)
- **CRM poblado**: 123 landings creados en tabla landings
- **syncVideosFromGCS()**: auto-recupera video URLs de GCS al reiniciar Render
- **Documentación completa** del sistema

### v2.9.0 (6 Feb 2026)
- Terra: Gemini 2.5 Flash TTS, knowledge base, auto-resume sesión, historial
- Chat IA en landing con contexto producto+tienda

### v2.8.0 (5 Feb 2026)
- Terra v1: orbe animado, voz, QR scanner integrado, NFC
- Chat IA en landing

### v2.7.0 (5 Feb 2026)
- Landing page premium rediseñada
- 123 productos con galerías y specs
- Mobile responsive

### v2.6.0 - v2.2.0
- Backend completo: samples, quotes, reviews, analytics
- Google Cloud Storage para videos
- QR generator, editor de productos

---

## Soporte

**Repositorio:** https://github.com/edsonnoyola/cesantoni-experience
**Producción:** https://cesantoni-experience.onrender.com
**CRM:** https://cesantoni-experience.onrender.com/index.html
