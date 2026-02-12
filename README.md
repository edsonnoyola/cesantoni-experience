# Cesantoni Experience

Sistema QR + Landing Pages + Video AI + Asistente Terra para Cesantoni (porcelanato premium mexicano).

## Funcionalidades

- **123 productos** con imágenes, descripciones y videos AI
- **407 tiendas** en todo México
- **Landings dinámicos** — 1 HTML sirve 42,000+ URLs únicas (producto × tienda)
- **Videos con IA** — Generación automática con Google Veo 2.0 + logo Cesantoni
- **Terra** — Asistente AI en tienda (Gemini 2.0 Flash + TTS Kore) con escaneo QR
- **CRM Dashboard** — Escaneos, conversiones WhatsApp, leads por tienda
- **QR Codes** — Página estática con 123 QR embebidos para impresión
- **NFC Tags** — Instrucciones y URLs para programar tags en tienda
- **Tracking** — Escaneos por producto, tienda, fecha + clicks WhatsApp

## Deploy

**Producción:** Render (https://cesantoni-experience-za74.onrender.com)
**QR Codes:** Vercel (https://cesantoni-qr.vercel.app)

### Variables de entorno

```
GOOGLE_API_KEY=tu_api_key_de_google
GCS_BUCKET=cesantoni-videos
GCS_KEY_FILE=gcs-key.json
```

### Desarrollo local

```bash
npm install
npm start
# Dashboard: http://localhost:3000
# HTTPS (para cámara): https://localhost:3443
```

## URLs

| Ruta | Descripción |
|------|-------------|
| `/` | Dashboard CRM |
| `/terra.html` | Asistente AI en tienda |
| `/landing/{slug}` | Landing del producto |
| `/p/{SKU}?store={slug}` | Landing por SKU + tienda |
| `/qr-tienda.html` | Generador QR (requiere API) |
| `/productos-edit.html` | Editor de productos + videos |

## API Endpoints

```
GET  /api/products              - Lista productos
GET  /api/stores                - Lista tiendas
GET  /api/analytics/overview    - Dashboard analytics
GET  /api/terra/sessions        - Leads de Terra
POST /api/terra                 - Chat con Terra AI
POST /api/terra/session         - Gestión sesiones Terra
POST /api/video/generate        - Generar video con Veo 2.0
POST /api/track/scan            - Registrar escaneo QR
POST /api/track/whatsapp        - Registrar click WhatsApp
POST /api/tts                   - Text-to-Speech (Gemini Kore)
DELETE /api/terra/sessions      - Reset leads
DELETE /api/admin/scans         - Reset escaneos
```

## Stack

- Node.js 22 / Express
- SQLite (better-sqlite3)
- Google Gemini 2.0 Flash (AI conversacional)
- Google Gemini 2.5 Flash TTS (voz Kore)
- Google Veo 2.0 (generación de video)
- Google Cloud Storage (hosting de videos)
- FFmpeg (overlay logo en videos)
- QRCode.js (generación QR)
- jsQR (escaneo QR en browser)

## Estructura

```
cesantoni-crm/
├── server.js              # Backend principal (Express)
├── database.js            # Setup SQLite + seed data
├── public/
│   ├── index.html         # Dashboard CRM
│   ├── terra.html         # Asistente AI (QR scanner + chat + TTS)
│   ├── landing.html       # Template landing producto
│   ├── qr-tienda.html     # Generador QR dinámico
│   ├── productos-edit.html # Editor productos
│   ├── logo-cesantoni.png # Logo para overlay en videos
│   └── videos/            # Videos generados localmente
├── gcs-key.json           # Credenciales GCS (no en repo)
├── render.yaml            # Config Render
└── nixpacks.toml          # Instala FFmpeg en deploy
```

---

**Cesantoni Experience** — Marketing TDI / La Cocina
