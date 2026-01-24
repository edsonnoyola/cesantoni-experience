# 🏠 Cesantoni Experience

Sistema de QR codes + Landing Pages + Video AI para Cesantoni (cerámica premium mexicana).

## 🎯 Funcionalidades

- **105 productos** con imágenes y descripciones
- **407 tiendas** en todo México
- **Landings dinámicos** - 1 HTML sirve 42,000+ URLs únicas
- **Videos con IA** - Generación automática con Google Veo 3.1
- **Tracking** - Escaneos por producto, tienda, fecha
- **Generador de QRs** - PDF y CSV para distribución

## 🚀 Deploy

### Variables de entorno requeridas:
```
GOOGLE_API_KEY=tu_api_key_de_google
PORT=3000 (opcional, Railway lo asigna automático)
```

### Comandos:
```bash
npm install
node server.js
```

## 📱 URLs

- `/` - Dashboard admin
- `/qr-tiendas.html` - Generador de QRs
- `/p/{SKU}?store={slug}` - Landing del producto

## 📊 Stack

- Node.js + Express
- SQLite (sql.js)
- Google Veo 3.1 (videos)
- jsPDF + QRCode.js

---

**Cesantoni Experience** - Marketing TDI / La Cocina
