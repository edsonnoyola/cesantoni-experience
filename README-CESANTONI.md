# 🏠 Cesantoni Experience - Sistema de Tracking QR

Sistema completo de CRM para tracking de escaneos QR en showrooms de cerámica.

## 🚀 Instalación Rápida

```bash
# 1. Descomprimir
unzip cesantoni-experience.zip
cd cesantoni-experience

# 2. Instalar dependencias
npm install

# 3. Ejecutar
npm start

# 4. Abrir en navegador
# http://localhost:3000
```

## 📁 Estructura del Proyecto

```
cesantoni-experience/
├── server.js          # Servidor Express + APIs
├── database.js        # Base de datos SQLite (sql.js)
├── package.json       # Dependencias
├── data/
│   └── cesantoni.db   # Base de datos (se crea automáticamente)
├── public/
│   ├── index.html     # Dashboard CRM
│   └── landing.html   # Landing page de productos
└── uploads/           # Archivos subidos
```

## 🔗 Endpoints API

### Productos
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/products` | Listar productos |
| GET | `/api/products/:id` | Obtener producto |
| POST | `/api/products` | Crear producto |
| PUT | `/api/products/:id` | Actualizar producto |
| DELETE | `/api/products/:id` | Desactivar producto |

### Distribuidores
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/distributors` | Listar distribuidores |
| GET | `/api/distributors/:id` | Obtener distribuidor + tiendas |
| POST | `/api/distributors` | Crear distribuidor |

### Tiendas
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/stores` | Listar tiendas |
| GET | `/api/stores/:id` | Obtener tienda |
| POST | `/api/stores` | Crear tienda |
| PUT | `/api/stores/:id` | Actualizar tienda |

### Tracking
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/track/scan` | Registrar escaneo QR |
| POST | `/api/track/whatsapp` | Registrar click WhatsApp |

### Analytics
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/analytics/overview` | KPIs generales |
| GET | `/api/analytics/by-state` | Escaneos por estado (heat map) |
| GET | `/api/analytics/by-store` | Top tiendas |
| GET | `/api/analytics/by-product` | Top productos |
| GET | `/api/analytics/by-day` | Escaneos por día |
| GET | `/api/analytics/recent` | Actividad reciente |

### QR Generator
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/qr/generate` | Generar QR para producto+tienda |
| GET | `/api/qr/list` | Listar QRs generados |

## 📱 Landing Pages Dinámicas

Las landing pages se acceden via:
```
/p/{SKU}?tienda={dist-tienda}&estado={estado}&ciudad={ciudad}&wa={whatsapp}&promo={descuento}
```

Ejemplo:
```
http://localhost:3000/p/vol-3060-est?tienda=interceramic-polanco&estado=CDMX&ciudad=Ciudad+de+México&wa=5215512345678&promo=15%
```

## 📊 Flujo del Sistema

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   QR en Tienda   │────▶│   Landing Page   │────▶│    WhatsApp      │
│   (con params)   │     │   (tracking)     │     │   (conversión)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                     BASE DE DATOS                           │
    │  • scans (escaneos)                                         │
    │  • whatsapp_clicks (conversiones)                           │
    │  • products, stores, distributors                           │
    └─────────────────────────────────────────────────────────────┘
         │
         ▼
    ┌──────────────────┐
    │   Dashboard CRM  │
    │   • Heat map MX  │
    │   • Analytics    │
    │   • QR Generator │
    └──────────────────┘
```

## 🗄️ Base de Datos

**Tablas principales:**

- `products` - Catálogo de productos (SKU, specs, precios)
- `distributors` - Cadenas distribuidoras
- `stores` - Tiendas/sucursales con ubicación y WhatsApp
- `scans` - Registro de cada escaneo QR
- `whatsapp_clicks` - Registro de clicks a WhatsApp
- `qr_codes` - QRs generados

**Datos de prueba incluidos:**
- 12 productos
- 6 distribuidores
- 19 tiendas
- 500 escaneos simulados
- ~100 clicks WhatsApp

## ⚙️ Variables de Entorno

```bash
PORT=3000              # Puerto del servidor
BASE_URL=http://localhost:3000  # URL base para QRs
```

## 🚀 Deploy a Producción

### Railway/Render/Heroku
```bash
# El proyecto está listo para deploy
# Solo asegura que PORT venga del environment
```

### VPS Manual
```bash
# Instalar PM2
npm install -g pm2

# Ejecutar con PM2
pm2 start server.js --name cesantoni

# Auto-restart
pm2 startup
pm2 save
```

### Docker (opcional)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## 📈 Próximos Pasos

1. **Cambiar BASE_URL** en producción para que los QRs apunten al dominio correcto
2. **Agregar SSL** (https)
3. **Conectar Google Analytics** para tracking adicional
4. **Subir imágenes/videos** de productos
5. **Integrar Veo 3** para generar videos automáticos

## 🆘 Soporte

- Dashboard: `http://localhost:3000`
- Landing ejemplo: `http://localhost:3000/p/vol-3060-est?tienda=interceramic-polanco&estado=CDMX`

---

**Cesantoni Experience** © 2025
