# CESANTONI EXPERIENCE - Sistema QR + Video AI

## Versión 2.4.0 | Febrero 2026

---

## 🎯 Resumen Ejecutivo

Sistema completo para Cesantoni que genera landing pages personalizadas por tienda y producto, códigos QR únicos para tracking, y videos con IA usando Veo 3.1 que usan la imagen real del producto como base.

**Métricas:**
- 123 productos con datos enriquecidos
- 407 tiendas con datos de contacto
- 16 distribuidores
- 13 videos generados con IA
- Videos almacenados en Google Cloud Storage

**URLs:**
- **Producción:** https://cesantoni-experience.onrender.com
- **GitHub:** https://github.com/edsonnoyola/cesantoni-experience

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    CESANTONI EXPERIENCE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Dashboard │    │ QR Gen   │    │ Landing  │              │
│  │ index.html│    │ qr-tiendas│   │ /p/:slug │              │
│  └─────┬─────┘    └─────┬────┘    └────┬─────┘              │
│        │                │               │                    │
│        └────────────────┴───────────────┘                    │
│                         │                                    │
│                    ┌────▼────┐                               │
│                    │ Express │  ← Render.com                 │
│                    │ Server  │                               │
│                    └────┬────┘                               │
│                         │                                    │
│   ┌─────────────────────┼─────────────────────┐             │
│   │          │          │          │          │              │
│ ┌─▼───┐  ┌───▼───┐  ┌───▼───┐  ┌───▼───┐  ┌──▼──┐         │
│ │SQLite│  │Veo 3.1│  │ GCS   │  │FFmpeg │  │ QR  │         │
│ │  DB  │  │  API  │  │Videos │  │ Logo  │  │Code │         │
│ └──────┘  └───────┘  └───────┘  └───────┘  └─────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Estructura de Archivos

```
cesantoni-crm/
├── server.js                 # Backend principal (Express)
├── database.js               # Wrapper SQLite con sql.js
├── package.json              # Dependencias
├── .env                      # Variables de entorno
├── .env.example              # Template de variables
├── gcs-credentials.json      # Credenciales GCS (no en git)
├── data/
│   └── cesantoni.db          # Base de datos SQLite
├── public/
│   ├── index.html            # Dashboard principal
│   ├── landing.html          # Landing dinámico con beneficios personalizados
│   ├── landings.html         # Gestor de landings
│   ├── qr-tiendas.html       # Generador de QRs
│   ├── productos-edit.html   # Editor de productos
│   └── images/
│       └── logo-cesantoni.png
├── scripts/
│   ├── update-product-types.js    # Actualizar tipos de productos
│   ├── add-related-products.js    # Agregar productos relacionados
│   ├── migrate-videos-to-gcs.js   # Migrar videos a GCS
│   └── enrich-all-products.js     # Enriquecer productos desde web
├── docs/
│   └── SETUP-GCS.md          # Guía configuración GCS
└── generate-alpes.mjs        # Ejemplo generación video
```

---

## 🚀 Funcionalidades

### 1. Landing Pages Personalizadas (/p/:slug)

**Beneficios dinámicos según producto:**
- **Por tipo:** Pasta Blanca, Porcelánico, Porcelánico Rectificado
- **Por categoría:** Madera, Mármol, Piedra, Cemento
- **Por uso:** Interior, Exterior, Baño, Comercial
- **Por acabado:** Pulido, Mate, Satinado

**Secciones:**
- Hero con imagen del producto
- Video con IA (si existe)
- Beneficios personalizados (6 cards)
- Especificaciones técnicas
- Aplicaciones recomendadas
- Galería de imágenes
- Productos similares (upselling)
- Información de tienda
- Botón WhatsApp

**URLs:**
```
/p/alabama                    # Por slug
/p/CES-ALABAMA               # Por SKU
/p/alabama?store=cesantoni-polanco  # Con tienda
```

### 2. Generación de Video con Veo 3.1

**Características:**
- **Image-to-Video:** Usa la imagen del producto como primer frame
- **Narración en español:** Voz femenina mexicana
- **Música de piano:** Fondo suave automático
- **Almacenamiento GCS:** Videos persistentes en la nube

**Proceso:**
```
1. Descargar imagen del producto
2. Convertir a base64
3. Enviar a Veo 3.1 con prompt + imagen
4. Polling hasta completar (~2-3 min)
5. Descargar video de URL temporal
6. Subir a Google Cloud Storage
7. Actualizar video_url en DB
```

**Prompt optimizado:**
```
Cinematic slow motion video with native audio.
A warm female voice with Mexican Spanish accent narrates:
"[Nombre]. [Descripción]. Cesantoni."

Gentle camera pan across this elegant [categoria] floor tile
in a modern [espacio] with natural lighting.
Soft piano music in background.
Professional interior photography. No people.
```

### 3. Google Cloud Storage

**Configuración:**
- **Bucket:** `cesantoni-videos`
- **Proyecto:** `sara-veo3-prod`
- **Service Account:** `cesantoni-storage@sara-veo3-prod`

**URLs de videos:**
```
https://storage.googleapis.com/cesantoni-videos/videos/alabama.mp4
https://storage.googleapis.com/cesantoni-videos/videos/alpes.mp4
```

### 4. Generador de QRs por Tienda

**Flujo:**
1. Seleccionar productos (multi-select)
2. Seleccionar tiendas (filtros en cascada)
3. Generar PDF/CSV con QRs únicos

**URL única por QR:**
```
https://cesantoni-experience.onrender.com/p/alabama?store=cesantoni-polanco
```

---

## 🔧 API Endpoints

### Productos
```
GET    /api/products              # Lista todos
GET    /api/products/:id          # Detalle
PUT    /api/products/:id          # Actualizar
DELETE /api/products/:id/video    # Borrar video
```

### Tiendas y Distribuidores
```
GET    /api/stores                # Lista tiendas
PUT    /api/stores/:id            # Actualizar tienda
GET    /api/distributors          # Lista distribuidores
PUT    /api/distributors/:id      # Actualizar distribuidor
```

### Videos
```
POST   /api/video/generate        # Generar con Veo 3.1
GET    /api/videos                # Lista videos existentes
```

### Promociones
```
GET    /api/promotions/for-product/:identifier  # Precio con promo
```

### Scans (Tracking)
```
POST   /api/scans                 # Registrar scan QR/NFC
GET    /api/scans                 # Lista scans
```

---

## 🗄️ Base de Datos

### Tabla: products
```sql
id, sku, name, slug, description, category, format, finish,
type (PORCELÁNICO RECTIFICADO, PASTA BLANCA, etc),
pei, uses, image_url, video_url, gallery, related_products,
base_price, active, created_at, updated_at
```

### Tabla: stores
```sql
id, name, slug, distributor_id, distributor_name,
address, city, state, whatsapp, phone, email,
lat, lng, created_at
```

### Tabla: scans
```sql
id, product_id, store_id, source (qr/nfc),
user_agent, referrer, utm_source, utm_medium, utm_campaign,
created_at
```

---

## 🚀 Deployment

### Variables de Entorno (Render)
```
BASE_URL=https://cesantoni-experience.onrender.com
GOOGLE_API_KEY=AIza...
GCS_BUCKET=cesantoni-videos
GCS_CREDENTIALS={"type":"service_account",...}
NODE_ENV=production
```

### Comandos Útiles
```bash
# Iniciar servidor local
node server.js

# Actualizar tipos de productos
node scripts/update-product-types.js

# Agregar productos relacionados
node scripts/add-related-products.js

# Migrar videos a GCS
node scripts/migrate-videos-to-gcs.js

# Generar video para un producto
node generate-alpes.mjs
```

---

## 🔄 Changelog

### v2.4.0 (3 Feb 2026)
- ✅ Google Cloud Storage para videos
- ✅ Landing pages con beneficios personalizados
- ✅ Productos relacionados para upselling
- ✅ Tipos de producto (Pasta Blanca, Porcelánico, etc.)
- ✅ Categorías (Madera, Mármol, Piedra, Cemento)
- ✅ Image-to-video usando imagen real del producto
- ✅ 123 productos enriquecidos
- ✅ Scripts de migración y actualización

### v2.3.0 (2 Feb 2026)
- ✅ Veo 3.1 con voz nativa en español
- ✅ Descripciones únicas por producto
- ✅ Multi-select QR generator
- ✅ Galería de imágenes con lightbox

### v2.2.0 (24 Ene 2026)
- ✅ Veo 3.1 image-to-video funcionando
- ✅ Música de fondo automática
- ✅ Página editor de productos
- ✅ Endpoint DELETE video

### v2.1.0 (24 Ene 2026)
- ✅ Filtro por ciudad en generador QR
- ✅ Descripciones auto-generadas
- ✅ Badges de estado en productos
- ✅ Railway deployment preparado

### v2.0.0 (23 Ene 2026)
- ✅ Generador QR por tienda
- ✅ Landing pages dinámicas
- ✅ Integración Veo 3.1
- ✅ Logo automático con FFmpeg

---

## 📊 Productos por Tipo

| Tipo | Cantidad |
|------|----------|
| PORCELÁNICO RECTIFICADO | 115 |
| PORCELÁNICO | 6 |
| PASTA BLANCA | 6 |

## 📊 Productos por Categoría

| Categoría | Cantidad |
|-----------|----------|
| Pisos (genérico) | 67 |
| MÁRMOL | 21 |
| PIEDRA | 16 |
| MADERA | 13 |
| CEMENTO | 3 |

---

## 📞 Soporte

**Repositorio:** https://github.com/edsonnoyola/cesantoni-experience
**Producción:** https://cesantoni-experience.onrender.com

---

## 🎯 Próximos Pasos

1. [ ] Generar videos para todos los productos
2. [ ] Dashboard de analytics avanzado
3. [ ] Bulk video generation (cola de procesamiento)
4. [ ] App móvil para vendedores
5. [ ] Integración NFC tags
