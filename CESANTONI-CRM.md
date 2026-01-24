# 🏠 CESANTONI EXPERIENCE CRM v2.1

## Resumen Ejecutivo
Sistema QR + Landing Pages + Video AI para Cesantoni (cerámica premium mexicana).
Genera QRs únicos por producto/tienda, videos con Veo 3.1, trackea escaneos y gestiona landings premium.

**Fecha última actualización:** 24 Enero 2026  
**Versión:** 2.1

---

## 🎯 Funcionalidades Principales

### 1. Generador de QRs por Tienda (`/qr-tiendas.html`)
- **Wizard 3 pasos:** Producto → Tiendas → Generar
- Filtros: Distribuidor → Estado → Ciudad
- Vista de estado por producto (✅ Video / ❌ Sin video)
- Generación de video directo desde tarjeta de producto
- Exportar PDF con QRs o CSV con URLs

### 2. Landing Pages Premium
- **1 landing por producto → miles de URLs únicas**
- URL format: `/p/{SKU}?store={store-slug}`
- Cada URL = 1 QR = 1 huella digital para tracking
- Muestra datos de la tienda específica (WhatsApp, dirección)

### 3. Generación de Video con IA (Veo 3.1)
- Videos cinematográficos de 8 segundos
- Fallback automático si falla con imagen de referencia
- Logo Cesantoni automático (watermark con ffmpeg)
- Prompt optimizado para pisos cerámicos

### 4. Dashboard Analytics
- Heat map de México por escaneos
- Rankings: productos, tiendas, distribuidores
- Métricas en tiempo real

---

## 📁 Estructura del Proyecto

```
~/Downloads/Cesantoni crm claude/
├── server.js                    # Servidor Express + API completa
├── package.json
├── .env                         # GOOGLE_API_KEY para Veo 3.1
├── data/
│   └── cesantoni.db            # Base de datos SQLite
├── public/
│   ├── index.html              # Dashboard principal
│   ├── landing.html            # Template landing premium
│   ├── qr-tiendas.html         # 🆕 Generador QRs por tienda
│   ├── landings.html           # Gestión de landings
│   ├── images/
│   │   └── logo-cesantoni.png  # Logo para UI
│   └── videos/                 # Videos generados
├── sync-images.js              # Script auditoría imágenes
├── add-descriptions.js         # 🆕 Script para generar descripciones
└── logo-cesantoni.png          # Logo para ffmpeg watermark
```

---

## 🗄️ Base de Datos (SQLite)

### Tabla products (105 registros)
```sql
id, sku, name, slug, url, image_url, video_url,
category, subcategory, format, finish, type,
resistance, water_absorption, mohs, usage,
pieces_per_box, sqm_per_box, weight_per_box,
description,  -- 🆕 Generada automáticamente
base_price, pdf_url, active, created_at, updated_at
```

### Tabla stores (407 registros)
```sql
id, distributor_id, name, slug, address, city, state, zip,
phone, whatsapp, email, lat, lng, active
```

### Tabla distributors (16 registros)
```sql
id, name, slug, contact_name, phone, email, active
```

### Tabla landings
```sql
id, product_id, title, description, promo_text, 
video_url, image_url, active, created_at, updated_at
```

### Tabla scans (tracking)
```sql
id, product_id, store_id, session_id, ip_address, 
user_agent, referrer, utm_source, utm_medium, utm_campaign, created_at
```

---

## 📊 Estado Actual

| Componente | Estado | Cantidad |
|------------|--------|----------|
| Productos | ✅ | 105 |
| Imágenes corregidas | ✅ | 97 |
| Descripciones | ✅ | 105 |
| Videos | ⚠️ | 1 (Alabama) |
| Tiendas | ✅ | 407 |
| Distribuidores | ✅ | 16 |

---

## 🔌 API Endpoints

### Productos
- `GET /api/products` - Lista todos
- `GET /api/products/:id` - Detalle
- `PUT /api/products/:id` - Actualizar

### Tiendas
- `GET /api/stores` - Lista (filtros: state, distributor_id, slug, city)
- `GET /api/stores/:id` - Detalle

### Landings
- `GET /api/landings` - Lista todos
- `POST /api/landings` - Crear/actualizar
- `GET /api/landings/by-product/:sku` - Por SKU

### Landing Page Frontend
- `GET /p/:sku` - Serve landing.html
- `GET /api/promotions/for-product/:sku` - Datos producto + promoción

### Video (Veo 3.1)
- `POST /api/video/generate` - Generar video con fallback automático
- `GET /api/videos` - Lista videos

### Tracking
- `POST /api/scans` - Registrar escaneo
- `POST /api/track/whatsapp` - Registrar click WhatsApp

---

## 🎬 Generación de Video (Veo 3.1)

### Flujo con fallback
1. Intenta generar con imagen de referencia
2. Si falla (error 400), reintenta sin imagen
3. Descarga video, agrega logo con ffmpeg
4. Guarda en `/public/videos/{producto}.mp4`

### Config .env
```
GOOGLE_API_KEY=tu_api_key_aquí
```

---

## 🛠️ Scripts de Mantenimiento

```bash
# Sincronizar imágenes con cesantoni.com.mx
node sync-images.js

# Agregar descripciones a productos
node add-descriptions.js
```

---

## 🚀 Iniciar

```bash
cd ~/Downloads/Cesantoni\ crm\ claude/
node server.js
```

**URLs:**
- Dashboard: http://localhost:3000
- Generador QRs: http://localhost:3000/qr-tiendas.html
- Landing ejemplo: http://localhost:3000/p/CES-ALABAMA?store=cesantoni-fresnillo

---

## 🔄 Changelog

### v2.1 (24 Enero 2026)
- ✅ Nueva página `/qr-tiendas.html` - Generador visual de QRs
- ✅ Filtro de Ciudad agregado a tiendas
- ✅ Estado de video visible en tarjetas de producto
- ✅ Botón generar video directo desde tarjeta
- ✅ Script `add-descriptions.js` - 105 descripciones generadas
- ✅ Fallback en Veo 3.1 si falla imagen de referencia
- ✅ Fix endpoint `/api/scans`

### v2.0 (24 Enero 2026)
- Arquitectura: 1 landing → miles de URLs vía `?store=`
- Tabla `landings` en SQLite
- Sincronización imágenes vs cesantoni.com.mx
- Video Veo 3.1 con imagen referencia

### v1.0 (23 Enero 2026)
- Sistema inicial QR + promociones + analytics

---

**Stack:** Node.js, Express, SQLite (sql.js), Veo 3.1, FFmpeg, jsPDF
