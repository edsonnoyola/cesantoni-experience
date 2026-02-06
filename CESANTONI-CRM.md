# CESANTONI EXPERIENCE - Sistema QR + Video AI

## Versión 2.8.0 | 5 Febrero 2026

---

## Resumen Ejecutivo

Sistema completo para Cesantoni que genera landing pages premium personalizadas por tienda y producto, códigos QR/NFC únicos para tracking, videos con IA (Veo 2.0/3.0), asistente de chat con Gemini, y Terra: asistente de voz figital.

**Métricas:**
- 123 productos con datos enriquecidos y galerías
- 81 productos con specs técnicas completas
- 122 productos con productos relacionados
- 19 videos generados con IA (Veo 3.0/2.0)
- 407 tiendas con datos de contacto
- 16 distribuidores
- Videos almacenados en Google Cloud Storage
- Landing page premium con diseño gold/negro
- Chat IA con Gemini 2.0 Flash

**URLs:**
- **Producción:** https://cesantoni-experience.onrender.com
- **GitHub:** https://github.com/edsonnoyola/cesantoni-experience

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    CESANTONI EXPERIENCE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Dashboard │  │ QR Gen   │  │ Landing  │  │ AI Chat  │   │
│  │ index    │  │ qr-tiendas│  │ /p/:slug │  │ Gemini   │   │
│  └─────┬────┘  └─────┬────┘  └────┬─────┘  └────┬─────┘   │
│        │             │            │              │          │
│        └─────────────┴────────────┴──────────────┘          │
│                              │                               │
│                         ┌────▼────┐                          │
│                         │ Express │  ← Render.com            │
│                         │ Server  │                          │
│                         └────┬────┘                          │
│                              │                               │
│   ┌──────────────────────────┼──────────────────────────┐   │
│   │        │        │        │        │        │        │   │
│ ┌─▼──┐ ┌───▼──┐ ┌───▼──┐ ┌───▼──┐ ┌───▼──┐ ┌───▼──┐     │
│ │SQL │ │Veo   │ │ GCS  │ │Gemini│ │ QR   │ │ NFC  │     │
│ │ite │ │2.0/3 │ │Videos│ │ Chat │ │Code  │ │ Tags │     │
│ └────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

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
│   ├── landing.html          # Landing con todas las features
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

## Funcionalidades del Landing (/p/:slug)

### 1. Video Hero Fullscreen
- Video generado con IA (Veo) como fondo si existe
- Fallback a imagen del producto si no hay video
- Overlay con gradiente negro
- Tag de categoría, título del producto, descripción inspiracional
- Animación fadeInUp escalonada
- Scroll indicator animado

### 2. Galería de Imágenes
- Grid responsive de imágenes del producto
- Lightbox con navegación (click, flechas ←/→, Esc)
- Se oculta si no hay galería

### 3. Información del Producto
- Imagen principal con borde dorado decorativo
- Categoría, nombre, formato + acabado
- Descripción técnica auto-generada según specs del producto
- 4 mini-specs destacadas (PEI, Mohs, Absorción, Uso)

### 4. Beneficios
- 3 cards fijas: Resistencia Superior, Diseño Único, Garantía Premium
- Hover con barra dorada animada + translateY

### 5. Especificaciones Técnicas
- Grid de 8 specs siempre visibles con defaults inteligentes
- Formato, PEI, Absorción, Acabado, Tipo, Uso, Mohs, Calidad de Exportación
- Fondo cream/blanco para contraste

### 6. Productos Relacionados
- 4 productos de la misma categoría
- Cards con imagen, nombre, categoría
- Hover con scale + translateY
- Link a su landing individual

### 7. Información de Tienda
- Nombre, dirección, teléfono
- Mapa de Google Maps embebido (si hay lat/lng)
- Promo banner dorado (si viene en URL params)

### 8. WhatsApp CTA
- Botón flotante fijo (esquina inferior derecha)
- Mensaje pre-formateado con nombre del producto
- Solo aparece si hay número de WhatsApp

### 9. Chat IA (Gemini 2.0 Flash)
- Botón flotante dorado en esquina inferior izquierda
- Ventana de chat con mensajes estilo bot/usuario
- 3 sugerencias rápidas: resistencia, uso, limpieza
- Endpoint `/api/chat` con contexto de producto + tienda
- Respuestas en español mexicano, máx 3 oraciones

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

### Muestras
```
POST   /api/samples               # Solicitar muestra
GET    /api/samples               # Lista solicitudes (admin)
PUT    /api/samples/:id           # Actualizar status
```

### Cotizaciones
```
POST   /api/quotes                # Crear cotización
GET    /api/quotes                # Lista cotizaciones (admin)
```

### Reviews
```
POST   /api/reviews               # Crear review
GET    /api/products/:id/reviews  # Reviews por producto
```

### Terra (Asistente de Voz)
```
GET    /terra                     # Página de Terra
POST   /api/terra                 # Enviar mensaje a Terra
       Body: { message, current_product_id }
       Response: { intent, speech, product, action }
```

### Chat IA
```
POST   /api/chat                  # Enviar mensaje al asistente
       Body: { message, product, store }
       Response: { reply }
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
type, pei, uses, image_url, video_url, gallery, related_products,
base_price, active, created_at, updated_at
```

### Tabla: stores
```sql
id, name, slug, distributor_id, distributor_name,
address, city, state, whatsapp, phone, email, lat, lng
```

### Tabla: sample_requests
```sql
id, product_id, product_name, store_id, store_name,
customer_name, customer_phone, customer_email, address,
status, notes, created_at
```

### Tabla: quotes
```sql
id, product_id, product_name, product_sku, m2, price_per_m2,
total, store_id, store_name, customer_name, customer_email,
customer_phone, status, created_at
```

### Tabla: reviews
```sql
id, product_id, store_id, rating, comment, customer_name,
verified_purchase, approved, created_at
```

### Tabla: scans
```sql
id, product_id, store_id, source (qr/nfc),
user_agent, referrer, utm_source, utm_medium, utm_campaign
```

---

## Variables de Entorno

```
BASE_URL=https://cesantoni-experience.onrender.com
GOOGLE_API_KEY=AIza...           # Para Veo 2.0/3.0 y Gemini
GCS_BUCKET=cesantoni-videos
GCS_CREDENTIALS={"type":"service_account",...}
NODE_ENV=production
```

---

## Changelog

### v2.8.0 (5 Feb 2026)
- **Terra - Asistente de Voz Figital**
  - Interfaz de voz con orbe animado gold/negro
  - Web Speech API: reconocimiento y sintesis de voz en espanol mexicano
  - Gemini 2.0 Flash con catalogo completo de productos
  - Recomienda productos segun necesidad del cliente
  - Busqueda por numero de exhibicion
  - Muestra mini-card del producto con link a landing
  - Sugerencias rapidas contextuales
  - Fallback de texto para navegadores sin microfono
  - Endpoint `/api/terra` con respuesta JSON estructurada
  - Voz femenina, personalidad profesional elegante

- **Chat IA en Landing**
  - Boton flotante dorado en esquina inferior izquierda
  - Ventana de chat con sugerencias rapidas
  - Contexto de producto + tienda

### v2.7.0 (5 Feb 2026)
- **Landing Page Premium Rediseñada**
  - Video hero fullscreen con overlay elegante
  - Logo oficial Cesantoni en header y footer
  - Paleta gold/negro premium (Cormorant Garamond + Montserrat)
  - Animaciones fadeInUp y scroll indicator
  - Header fijo con efecto blur al scroll

- **Galería de Productos**
  - Grid responsive de imágenes del producto
  - Lightbox con navegación por teclado (←/→/Esc)
  - Imágenes filtradas (solo del producto, sin logos/iconos)
  - 123 productos con galerías actualizadas

- **Descripciones Duales**
  - Hero: descripción inspiracional/emocional
  - Producto: descripción técnica auto-generada según specs

- **Especificaciones Técnicas Premium**
  - 8 specs siempre visibles con defaults inteligentes
  - Formato, PEI, Absorción, Acabado, Tipo, Uso, Mohs, Calidad de Exportación
  - 81 productos actualizados con specs scrapeadas de cesantoni.com.mx
  - "Pasta Blanca" con label "Calidad de Exportación" para claridad

- **Responsive Mobile Optimizado**
  - Fix de barras negras en specs (overflow-x: hidden)
  - Fuentes reducidas para móvil (1.2rem en valores)
  - Grid de 2 columnas en specs para pantallas pequeñas
  - Padding y gaps optimizados para touch

- **Productos Relacionados**
  - 4 productos de la misma categoría
  - Cards con hover effect
  - 122 productos con relacionados generados

- **Videos Regenerados**
  - 19 videos con Veo 3.0/2.0 usando imágenes reales
  - Videos que coinciden con el color/textura del producto
  - Almacenados en Google Cloud Storage

### v2.6.0 (3 Feb 2026)
- Endpoints backend para: samples, quotes, reviews, promotions
- Chat IA backend con Gemini 2.0 Flash (`/api/chat`)
- Tracking de scans QR/NFC con analytics
- Páginas admin: comparar.html, favoritos.html, productos-edit.html

### v2.4.0 (3 Feb 2026)
- Google Cloud Storage para videos
- Landing pages con beneficios personalizados
- Productos relacionados para upselling
- Image-to-video usando imagen real del producto

### v2.3.0 (2 Feb 2026)
- Veo 3.1 con voz nativa en español
- Descripciones únicas por producto
- Multi-select QR generator

### v2.2.0 (24 Ene 2026)
- Veo 3.1 image-to-video
- Música de fondo automática
- Editor de productos

---

## NFC vs QR

| Aspecto | QR Code | NFC Tag |
|---------|---------|---------|
| Costo | ~$0.01 | ~$0.30 |
| Distancia | Hasta 3m | 1-4 cm |
| Velocidad | 1-2 seg | Instantáneo |
| Falsificable | Sí | No |

**Recomendación:**
- Muestras físicas en showroom → NFC + QR
- Material impreso/catálogo → Solo QR

---

## URLs de Ejemplo

```
# Landing de producto
/p/alabama
/p/alabama?store=cesantoni-polanco

# Páginas de usuario
/comparar.html
/favoritos.html

# Admin/Dashboard
/index.html
/qr-tiendas.html
/nfc.html
```

---

## Soporte

**Repositorio:** https://github.com/edsonnoyola/cesantoni-experience
**Producción:** https://cesantoni-experience.onrender.com
