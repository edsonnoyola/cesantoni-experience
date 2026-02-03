# CESANTONI EXPERIENCE - Sistema QR + Video AI

## Versión 2.6.0 | Febrero 2026

---

## Resumen Ejecutivo

Sistema completo para Cesantoni que genera landing pages personalizadas por tienda y producto, códigos QR/NFC únicos para tracking, videos con IA usando Veo 3.1, y asistente de chat con Gemini.

**Métricas:**
- 123 productos con datos enriquecidos
- 407 tiendas con datos de contacto
- 16 distribuidores
- 13 videos generados con IA
- Videos almacenados en Google Cloud Storage
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
│ │ite │ │ 3.1  │ │Videos│ │ Chat │ │Code  │ │ Tags │     │
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

### 1. Contenido Dinámico
- Hero con imagen del producto
- Video con IA (si existe)
- Beneficios personalizados por tipo/categoría
- Especificaciones técnicas
- Galería de imágenes
- Productos similares (upselling)
- Información de tienda
- Botón WhatsApp

### 2. Calculadora de m²
- Input de metros cuadrados
- Calcula cajas necesarias
- Calcula piezas totales
- Muestra costo total
- Botón para generar cotización

### 3. Sistema de Favoritos
- Botón corazón para guardar
- Almacenamiento en localStorage
- Página `/favoritos.html` para ver todos
- Compartir favoritos por WhatsApp

### 4. Comparador de Productos
- Agregar hasta 4 productos
- Badge flotante con contador
- Página `/comparar.html` con tabla lado a lado
- Compara: precio, formato, tipo, resistencia, etc.

### 5. Compartir
- WhatsApp: mensaje pre-formateado
- Email: asunto y cuerpo con detalles
- Copiar link: al portapapeles

### 6. Solicitar Muestra
- Modal con formulario
- Campos: nombre, teléfono, email, dirección
- Se guarda en base de datos
- Notificación al vendedor

### 7. Cotización Instantánea
- Genera cotización con datos del cálculo
- Campos: nombre, email, teléfono
- Se guarda en base de datos

### 8. Descuento por Escaneo
- Modal automático en primera visita (5 seg)
- Código de descuento 5% único
- Válido solo en tienda actual
- Se guarda en localStorage para no repetir

### 9. Chat IA (Gemini 2.0 Flash)
- Botón flotante en esquina inferior izquierda
- Responde sobre el producto actual
- Conoce: características, instalación, mantenimiento, precios
- Sugerencias rápidas pre-configuradas
- Contexto de tienda incluido

### 10. Visualizador de Espacios
- Tabs: Sala, Cocina, Baño, Recámara, Terraza
- Muestra imagen del espacio con overlay del piso
- Textura del producto se superpone en el piso
- Ayuda al cliente a visualizar el resultado

### 11. Meses Sin Intereses (MSI)
- Cards con opciones: 3, 6 y 12 meses
- Se actualiza automáticamente con la calculadora
- Muestra monto mensual por opción
- Logos de bancos participantes

### 12. Stock en Tiempo Real
- Indicador visual (verde/amarillo/rojo)
- Muestra cajas disponibles en tienda
- Se actualiza según tienda seleccionada
- Alerta de "últimas unidades"

### 13. Notificación al Vendedor
- Badge automático cuando cliente escanea
- Registra el escaneo en sesión
- Preparado para integración WhatsApp Business API

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
POST   /api/video/generate        # Generar con Veo 3.1
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
GOOGLE_API_KEY=AIza...           # Para Veo 3.1 y Gemini
GCS_BUCKET=cesantoni-videos
GCS_CREDENTIALS={"type":"service_account",...}
NODE_ENV=production
```

---

## Changelog

### v2.6.0 (3 Feb 2026)
- Visualizador de espacios: ver piso en sala/cocina/baño/recámara/terraza
- Meses sin intereses: calculador 3/6/12 MSI
- Stock en tiempo real: disponibilidad en tienda
- Notificación al vendedor: badge cuando escanean QR/NFC

### v2.5.0 (3 Feb 2026)
- Calculadora de m² con costo total
- Sistema de favoritos con localStorage
- Comparador de hasta 4 productos
- Compartir por WhatsApp/Email/Link
- Solicitar muestra gratis (modal + API)
- Cotización instantánea (modal + API)
- Sistema de reviews/opiniones
- Descuento 5% en primer escaneo
- Chat IA con Gemini 2.0 Flash
- Páginas: /comparar.html, /favoritos.html

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
