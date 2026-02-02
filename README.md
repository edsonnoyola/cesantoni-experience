# Cesantoni Experience

Sistema de QR codes + Landing Pages + Video AI para Cesantoni (cerámica premium mexicana).

## Funcionalidades

- **105 productos** con imágenes y descripciones
- **407 tiendas** en todo México
- **Landings dinámicos** - 1 HTML sirve 42,000+ URLs únicas
- **Videos con IA** - Generación automática con Google Veo 3.1
- **Tracking** - Escaneos por producto, tienda, fecha
- **Generador de QRs** - PDF y CSV para distribución

## Deploy en Railway

### 1. Crear proyecto en Railway

```bash
# Opción A: Desde GitHub
# Conecta tu repo en railway.app

# Opción B: CLI
npm install -g @railway/cli
railway login
railway init
railway up
```

### 2. Configurar variables de entorno

En Railway Dashboard > Variables:

```
GOOGLE_API_KEY=tu_api_key_de_google_veo
BASE_URL=https://tu-proyecto.up.railway.app
```

### 3. Deploy

Railway detecta automáticamente la configuración de `railway.json` y `nixpacks.toml`.
FFmpeg se instala automáticamente para procesamiento de video.

## Desarrollo local

```bash
# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env
# Editar .env con tu GOOGLE_API_KEY

# Iniciar servidor
npm start
```

## URLs

| Ruta | Descripción |
|------|-------------|
| `/` | Dashboard admin |
| `/qr-tiendas.html` | Generador de QRs |
| `/productos-edit.html` | Editor de productos + videos |
| `/p/{SKU}?store={slug}` | Landing del producto |

## API Endpoints

```
GET  /api/products          - Lista productos
GET  /api/stores            - Lista tiendas
GET  /api/distributors      - Lista distribuidores
GET  /api/analytics/overview - Resumen de analytics
POST /api/video/generate    - Generar video con Veo 3.1
POST /api/track/scan        - Registrar escaneo QR
```

## Stack

- Node.js 18+ / Express
- SQLite (sql.js)
- Google Veo 3.1 (video generation)
- FFmpeg (procesamiento de video)
- jsPDF + QRCode.js

## Estructura

```
cesantoni-crm/
├── server.js           # Backend principal
├── database.js         # Wrapper SQLite
├── data/cesantoni.db   # Base de datos
├── public/             # Frontend
│   ├── index.html      # Dashboard
│   ├── qr-tiendas.html # Generador QR
│   ├── landing.html    # Template landing
│   └── videos/         # Videos generados
├── railway.json        # Config Railway
└── nixpacks.toml       # Instala FFmpeg
```

---

**Cesantoni Experience** - Marketing TDI / La Cocina
