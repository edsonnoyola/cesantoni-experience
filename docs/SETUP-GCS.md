# Configurar Google Cloud Storage para Videos

## Paso 1: Crear Bucket

1. Ve a https://console.cloud.google.com/storage/browser
2. Click **"CREATE BUCKET"**
3. Configura:
   - **Name:** `cesantoni-videos` (debe ser único globalmente)
   - **Location:** `us-central1` (o región cercana a tus usuarios)
   - **Storage class:** Standard
   - **Access control:** Fine-grained
4. Click **"CREATE"**

## Paso 2: Configurar acceso público

1. Selecciona el bucket `cesantoni-videos`
2. Ve a la pestaña **"PERMISSIONS"**
3. Click **"GRANT ACCESS"**
4. En "New principals" escribe: `allUsers`
5. En "Role" selecciona: `Storage Object Viewer`
6. Click **"SAVE"**

Esto permite que los videos sean públicos (necesario para que funcionen en el landing).

## Paso 3: Crear Service Account

1. Ve a https://console.cloud.google.com/iam-admin/serviceaccounts
2. Click **"CREATE SERVICE ACCOUNT"**
3. Configura:
   - **Name:** `cesantoni-storage`
   - **Description:** Upload videos from server
4. Click **"CREATE AND CONTINUE"**
5. En "Grant access", selecciona rol: **"Storage Admin"**
6. Click **"CONTINUE"** → **"DONE"**

## Paso 4: Crear Key JSON

1. En la lista de service accounts, click en `cesantoni-storage@...`
2. Ve a la pestaña **"KEYS"**
3. Click **"ADD KEY"** → **"Create new key"**
4. Selecciona **"JSON"**
5. Click **"CREATE"**
6. Se descargará un archivo `.json` - **GUÁRDALO SEGURO**

## Paso 5: Configurar en Render

1. Ve a https://dashboard.render.com
2. Selecciona tu servicio `cesantoni-experience`
3. Ve a **"Environment"**
4. Agrega estas variables:

```
GCS_BUCKET=cesantoni-videos
GCS_CREDENTIALS=<contenido del JSON en una línea>
```

### Convertir JSON a una línea:

Abre terminal y ejecuta:
```bash
cat ~/Downloads/tu-archivo-credentials.json | tr -d '\n' | pbcopy
```

Esto copia el JSON en una línea al clipboard. Pégalo en `GCS_CREDENTIALS`.

## Paso 6: Verificar

Despliega en Render y revisa los logs. Deberías ver:
```
✅ Google Cloud Storage configurado: cesantoni-videos
```

## Migrar videos existentes

Una vez configurado, ejecuta este comando para migrar los videos actuales:

```bash
node scripts/migrate-videos-to-gcs.js
```

---

## Costos estimados

- **Storage:** $0.020/GB/mes
- **Egress:** $0.12/GB (primeros 10GB gratis)

Para 100 videos de 3MB = 300MB = ~$0.01/mes storage
