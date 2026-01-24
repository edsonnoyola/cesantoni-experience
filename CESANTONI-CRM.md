# CESANTONI EXPERIENCE - Sistema QR + Video AI

## Versión 2.2.0 | Enero 2026

---

## 🎯 Resumen Ejecutivo

Sistema completo para Cesantoni que genera landing pages personalizadas por tienda, códigos QR únicos para tracking, y videos con IA usando Veo 3.1 que respetan las imágenes de los productos.

**Métricas:**
- 105 productos con imágenes sincronizadas
- 407 tiendas con datos de contacto
- 16 distribuidores
- 42,735 combinaciones únicas de QR posibles (105 × 407)
- 10 tracks de música para videos

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    CESANTONI EXPERIENCE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Dashboard │    │ QR Gen   │    │ Edit     │              │
│  │ index.html│    │ qr-tiendas│   │ productos│              │
│  └─────┬─────┘    └─────┬────┘    └────┬─────┘              │
│        │                │               │                    │
│        └────────────────┴───────────────┘                    │
│                         │                                    │
│                    ┌────▼────┐                               │
│                    │ Express │                               │
│                    │ Server  │                               │
│                    └────┬────┘                               │
│                         │                                    │
│        ┌────────────────┼────────────────┐                  │
│        │                │                │                   │
│   ┌────▼────┐     ┌────▼────┐     ┌─────▼─────┐            │
│   │ SQLite  │     │ Veo 3.1 │     │  FFmpeg   │            │
│   │   DB    │     │   API   │     │ (logo+🎵) │            │
│   └─────────┘     └─────────┘     └───────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Estructura de Archivos

```
Cesantoni crm claude/
├── server.js                 # Backend principal
├── database.js               # Wrapper SQLite
├── package.json              # Dependencias
├── .env                      # GOOGLE_API_KEY
├── data/
│   └── cesantoni.db          # Base de datos
├── public/
│   ├── index.html            # Dashboard principal
│   ├── landing.html          # Template de landing (dinámico)
│   ├── landings.html         # Gestor de landings
│   ├── qr-tiendas.html       # Generador de QRs ⭐
│   ├── productos-edit.html   # Editor de productos ⭐
│   ├── images/
│   │   └── logo-cesantoni.png
│   ├── music/                # 🎵 Música de fondo
│   │   ├── music1.mp3
│   │   ├── music2.mp3
│   │   └── ... (hasta music10.mp3)
│   └── videos/               # Videos generados
│       ├── decker.mp4
│       ├── alabama.mp4
│       └── ...
├── railway.json              # Config Railway
├── .gitignore
└── README.md
```

---

## 🚀 Funcionalidades

### 1. Generador de QRs por Tienda (/qr-tiendas.html)

**Flujo de 3 pasos:**

1. **Seleccionar Producto** - Grid visual de 105 productos con:
   - Imagen del producto
   - Badges de estado (✅ Con video / ❌ Sin video)
   - Botón +Video para generar
   - Botón Vista Previa

2. **Seleccionar Tiendas** - Filtros en cascada:
   - Distribuidor → Estado → Ciudad → Tiendas
   - Selección múltiple o "Seleccionar todas"

3. **Generar** - Opciones de salida:
   - **PDF** con 6 QRs por página (nombre tienda, ciudad, producto)
   - **CSV** con URLs y datos de contacto

**URL única por QR:**
```
https://cesantoniexperience.com/p/CES-DECKER?store=cesantoni-fresnillo
```

### 2. Editor de Productos (/productos-edit.html)

- ✏️ Editar descripción de cada producto
- 🎬 Generar/Regenerar video con Veo 3.1
- 🗑️ Borrar video si no te gusta
- 👁️ Ver landing del producto
- 🔍 Buscar por nombre/SKU
- 🏷️ Filtrar con/sin video

### 3. Generación de Video con Veo 3.1

**Características:**
- **Image-to-Video**: Usa la foto del producto como base
- **Música automática**: Selecciona aleatoriamente de 10 tracks
- **Logo Cesantoni**: Se agrega automáticamente
- **Audio mezclado**: 30% Veo + 70% música de fondo

**Proceso técnico:**
```
1. Descarga imagen del producto (cesantoni.com.mx)
2. Envía a Veo 3.1 API (predictLongRunning)
3. Polling hasta completar (~2-3 min)
4. Descarga video generado
5. FFmpeg: agrega música de fondo
6. FFmpeg: agrega logo
7. Guarda en /public/videos/
8. Actualiza DB
```

**Prompt optimizado:**
```
Animate this floor image. Keep the EXACT same tile pattern and color. 
Slow camera pan revealing more of the same floor. 
Do not change or replace the tiles. 
Maintain the original texture throughout. 
Soft natural light. Gentle ambient room sounds.
```

### 4. Landing Pages Dinámicas (/p/:sku)

**Una landing sirve todas las combinaciones:**
- /p/CES-DECKER?store=cesantoni-fresnillo
- /p/CES-DECKER?store=interceramic-guadalajara
- etc.

**Contenido:**
- Video del producto (si existe)
- Imagen HD
- Descripción
- Especificaciones técnicas
- Botón WhatsApp con mensaje prellenado
- Logo y branding Cesantoni

---

## 🔧 API Endpoints

### Productos
```
GET    /api/products              # Lista todos
GET    /api/products/:id          # Detalle
GET    /api/products/sku/:sku     # Por SKU
PUT    /api/products/:id          # Actualizar
DELETE /api/products/:id/video    # Borrar video
```

### Tiendas
```
GET    /api/stores                # Lista todas
GET    /api/stores/:id            # Detalle
GET    /api/distributors          # Lista distribuidores
```

### Videos
```
POST   /api/video/generate        # Generar con Veo 3.1
GET    /api/videos                # Lista videos existentes
```

### Landings
```
GET    /api/landings              # Lista
POST   /api/landings              # Crear
PUT    /api/landings/:id          # Actualizar
DELETE /api/landings/:id          # Borrar
GET    /api/landings/by-product/:sku  # Por producto
```

---

## 🗄️ Base de Datos

### Tabla: products
```sql
id, sku, name, description, category, format, finish, type,
resistance, mohs, usage, pieces_per_box, image_url, video_url,
created_at, updated_at
```

### Tabla: stores
```sql
id, name, slug, distributor, address, city, state, 
whatsapp, phone, email, lat, lng, created_at
```

### Tabla: landings
```sql
id, product_id, title, description, promo_text,
video_url, image_url, created_at, updated_at
```

---

## 🎵 Música de Fondo

**Ubicación:** /public/music/

**Archivos:** music1.mp3 ... music10.mp3

**Comportamiento:**
- Se selecciona aleatoriamente para cada video
- Se mezcla con el audio de Veo (30/70)
- Formato: MP3, cualquier duración (se corta a duración del video)

---

## 🚀 Deployment

### Local
```bash
cd ~/Downloads/Cesantoni\ crm\ claude/
node server.js
# http://localhost:3000
```

### Railway (preparado)
```bash
# Archivos listos: railway.json, package.json, .gitignore
# Requiere cuenta Railway ($5/mes)
git push  # Auto-deploy
```

### Variables de Entorno
```
GOOGLE_API_KEY=tu_api_key_de_google
PORT=3000 (opcional)
BASE_URL=https://tu-dominio.com (opcional)
```

---

## 📋 Comandos Útiles

```bash
# Iniciar servidor
node server.js

# Sincronizar imágenes desde cesantoni.com.mx
node sync-images.js

# Agregar descripciones a productos
node add-descriptions.js
```

---

## 🔄 Changelog

### v2.2.0 (24 Ene 2026)
- ✅ Veo 3.1 image-to-video funcionando (endpoint predictLongRunning)
- ✅ Música de fondo automática (10 tracks)
- ✅ Página editor de productos
- ✅ Endpoint DELETE video
- ✅ Mejor manejo de errores en API
- ✅ Prompt optimizado para pisos

### v2.1.0 (24 Ene 2026)
- ✅ Filtro por ciudad en generador QR
- ✅ Descripciones auto-generadas
- ✅ Badges de estado en productos
- ✅ Railway deployment preparado
- ✅ GitHub repo configurado

### v2.0.0 (23 Ene 2026)
- ✅ Generador QR por tienda
- ✅ Landing pages dinámicas
- ✅ Integración Veo 3.1
- ✅ Logo automático con FFmpeg
- ✅ Sincronización de imágenes

---

## 📞 Soporte

**Desarrollado por:** Marketing TDI / La Cocina
**Cliente:** Cesantoni

---

## 🎯 Próximos Pasos

1. [ ] Conectar dominio personalizado
2. [ ] Dashboard de analytics avanzado
3. [ ] Bulk video generation (cola de procesamiento)
4. [ ] Integración con CRM Cesantoni
5. [ ] App móvil para vendedores
