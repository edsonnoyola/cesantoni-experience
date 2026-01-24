#!/usr/bin/env python3
"""
IMPORTADOR DE PRODUCTOS CESANTONI
==================================
Importa los 105 productos del JSON a la base de datos SQLite.

Uso:
  cd ~/Downloads/Cesantoni\ crm\ claude/
  python3 import-products.py
"""

import json
import sqlite3
import os

# Rutas
DB_PATH = 'data/cesantoni.db'
JSON_PATH = 'productos_cesantoni.json'

def main():
    print("=" * 60)
    print("🏠 IMPORTADOR DE PRODUCTOS CESANTONI")
    print("=" * 60)
    
    # Verificar archivos
    if not os.path.exists(JSON_PATH):
        print(f"❌ No se encontró {JSON_PATH}")
        return
    
    if not os.path.exists(DB_PATH):
        print(f"❌ No se encontró {DB_PATH}")
        return
    
    # Cargar productos del JSON
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        products = json.load(f)
    
    print(f"📦 Productos en JSON: {len(products)}")
    
    # Conectar a la base de datos
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Verificar estructura actual
    cursor.execute("SELECT COUNT(*) FROM products")
    current_count = cursor.fetchone()[0]
    print(f"📊 Productos actuales en DB: {current_count}")
    
    # Agregar columnas si no existen
    try:
        cursor.execute("ALTER TABLE products ADD COLUMN url TEXT")
        print("  ✅ Columna 'url' agregada")
    except:
        pass
    
    try:
        cursor.execute("ALTER TABLE products ADD COLUMN image_url TEXT")
        print("  ✅ Columna 'image_url' agregada")
    except:
        pass
    
    try:
        cursor.execute("ALTER TABLE products ADD COLUMN slug TEXT")
        print("  ✅ Columna 'slug' agregada")
    except:
        pass
    
    # Preguntar si borrar productos existentes
    print("\n⚠️  ¿Qué deseas hacer?")
    print("  1. REEMPLAZAR todos los productos (borra los actuales)")
    print("  2. AGREGAR solo productos nuevos (mantiene los actuales)")
    print("  3. CANCELAR")
    
    choice = input("\nOpción (1/2/3): ").strip()
    
    if choice == '3':
        print("❌ Cancelado")
        conn.close()
        return
    
    if choice == '1':
        # Borrar productos existentes
        cursor.execute("DELETE FROM products")
        print(f"🗑️  Eliminados {current_count} productos existentes")
    
    # Importar productos
    imported = 0
    updated = 0
    skipped = 0
    
    for p in products:
        sku = p.get('sku') or f"CES-{p['slug'].upper()}"
        name = p.get('name') or p['slug'].replace('-', ' ').title()
        
        # Verificar si ya existe
        cursor.execute("SELECT id FROM products WHERE sku = ? OR slug = ?", (sku, p['slug']))
        existing = cursor.fetchone()
        
        if existing and choice == '2':
            # Actualizar existente
            cursor.execute("""
                UPDATE products SET
                    name = ?,
                    url = ?,
                    image_url = ?,
                    category = COALESCE(?, category),
                    format = COALESCE(?, format),
                    finish = COALESCE(?, finish),
                    type = COALESCE(?, type),
                    usage = COALESCE(?, usage),
                    pieces_per_box = COALESCE(?, pieces_per_box),
                    sqm_per_box = COALESCE(?, sqm_per_box),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (
                name,
                p.get('url'),
                p.get('image_url'),
                p.get('category'),
                p.get('format'),
                p.get('finish'),
                p.get('type'),
                p.get('usage'),
                p.get('pieces_per_box'),
                p.get('sqm_per_box'),
                existing[0]
            ))
            updated += 1
        elif not existing or choice == '1':
            # Insertar nuevo
            cursor.execute("""
                INSERT INTO products (sku, slug, name, url, image_url, category, format, finish, type, usage, pieces_per_box, sqm_per_box, base_price, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (
                sku,
                p['slug'],
                name,
                p.get('url'),
                p.get('image_url'),
                p.get('category') or 'Pisos',
                p.get('format'),
                p.get('finish'),
                p.get('type'),
                p.get('usage'),
                p.get('pieces_per_box'),
                p.get('sqm_per_box'),
                450.00  # Precio base por defecto
            ))
            imported += 1
        else:
            skipped += 1
    
    # Crear tabla de promociones si no existe
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS promotions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            product_id INTEGER,
            scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'state', 'distributor', 'store')),
            scope_value TEXT,
            promo_price REAL NOT NULL,
            promo_text TEXT,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            until_stock INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    """)
    print("✅ Tabla 'promotions' verificada/creada")
    
    # Guardar cambios
    conn.commit()
    
    # Verificar resultado
    cursor.execute("SELECT COUNT(*) FROM products")
    final_count = cursor.fetchone()[0]
    
    print("\n" + "=" * 60)
    print("📊 RESUMEN")
    print("=" * 60)
    print(f"  ✅ Importados: {imported}")
    print(f"  🔄 Actualizados: {updated}")
    print(f"  ⏭️  Omitidos: {skipped}")
    print(f"  📦 Total en DB: {final_count}")
    
    # Mostrar muestra
    print("\n--- Muestra de productos ---")
    cursor.execute("SELECT sku, name, image_url FROM products LIMIT 5")
    for row in cursor.fetchall():
        img_status = "✅" if row[2] else "❌"
        print(f"  {img_status} {row[0]}: {row[1]}")
    
    conn.close()
    print("\n✅ ¡Importación completada!")
    print("\nReinicia el servidor:")
    print("  node server.js")

if __name__ == '__main__':
    main()
