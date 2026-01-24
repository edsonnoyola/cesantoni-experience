# Cesantoni Experience CRM

Sistema completo de tracking de productos vía QR para showrooms.

## 🚀 Instalación Rápida

```bash
# 1. Entrar al directorio
cd cesantoni-experience

# 2. Instalar dependencias
npm install

# 3. Iniciar servidor
npm start
```

## 📍 URLs

- **Dashboard:** http://localhost:3000
- **API:** http://localhost:3000/api

## 🔧 Primer Uso

1. Abre http://localhost:3000
2. Click en **"Cargar Datos Demo"** para poblar la base de datos
3. Explora el Dashboard, crea productos, tiendas y genera QRs

## 📊 Estructura

```
cesantoni-experience/
├── backend/
│   └── server.js          # API + Base de datos SQLite
├── frontend/
│   └── index.html         # Dashboard CRM
├── public/
│   ├── landings/          # Landing pages generadas
│   └── qrcodes/           # QR codes generados
├── data/
│   ├── cesantoni.db       # Base de datos SQLite
│   └── uploads/           # PDFs y archivos subidos
└── package.json
```

## 🔌 API Endpoints

### Productos
- `GET /api/productos` - Listar productos
- `POST /api/productos` - Crear producto
- `PUT /api/productos/:id` - Actualizar producto
- `DELETE /api/productos/:id` - Eliminar producto

### Distribuidores
- `GET /api/distribuidores` - Listar distribuidores
- `POST /api/distribuidores` - Crear distribuidor

### Tiendas
- `GET /api/tiendas` - Listar tiendas (filtrar: ?estado=CDMX)
- `POST /api/tiendas` - Crear tienda

### QR + Landing
- `POST /api/generar-qr` - Genera QR code + Landing page
  ```json
  { "producto_id": "volterra", "tienda_id": "interceramic-polanco" }
  ```

### Analytics
- `GET /api/analytics/stats` - Stats generales
- `GET /api/analytics/por-estado` - Escaneos por estado (heat map)
- `GET /api/analytics/top-productos` - Top productos escaneados
- `GET /api/analytics/top-tiendas` - Top tiendas (filtrar: ?estado=Jalisco)
- `GET /api/analytics/actividad-reciente` - Últimos escaneos

### Tracking
- `GET /p/:qrId` - Ruta de tracking (registra escaneo + redirect)
- `POST /api/track/whatsapp` - Registrar click en WhatsApp

## 🗺️ Flujo del Sistema

```
[QR en Showroom] 
    ↓ escaneo
[/p/:qrId] → registra escaneo en BD
    ↓ redirect
[/landings/:qrId.html] → Landing con specs + WhatsApp
    ↓ click
[/api/track/whatsapp] → registra conversión
    ↓
[Dashboard] → ve métricas en tiempo real
```

## 🎬 Pendiente: Integración Veo 3

Para generar videos con IA, necesitas:
1. API Key de Google Cloud (Vertex AI)
2. Habilitar Veo 3 en tu proyecto
3. Configurar en Settings del CRM

---

**Contacto:** Marketing TDI / La Cocina
