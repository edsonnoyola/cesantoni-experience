#!/usr/bin/env python3
"""
SCRAPER CESANTONI - Corre esto en tu Mac
========================================
1. Abre Terminal
2. cd ~/Downloads/Cesantoni\ crm\ claude/
3. pip3 install requests beautifulsoup4 pandas openpyxl
4. python3 scraper-cesantoni.py

Genera: productos_cesantoni.json con toda la info
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import re
import os

# URLs de productos
PRODUCT_URLS = [
    "https://www.cesantoni.com.mx/producto/sunset-maple/",
    "https://www.cesantoni.com.mx/producto/legacy-wood/",
    "https://www.cesantoni.com.mx/producto/merlot-wood/",
    "https://www.cesantoni.com.mx/producto/light-sandwood/",
    "https://www.cesantoni.com.mx/producto/quarzo-di-siena/",
    "https://www.cesantoni.com.mx/producto/bianco-quartz/",
    "https://www.cesantoni.com.mx/producto/romagni/",
    "https://www.cesantoni.com.mx/producto/cabo/",
    "https://www.cesantoni.com.mx/producto/fiorentino/",
    "https://www.cesantoni.com.mx/producto/bianco-magenta/",
    "https://www.cesantoni.com.mx/producto/calacatta-black/",
    "https://www.cesantoni.com.mx/producto/nobu/",
    "https://www.cesantoni.com.mx/producto/sterling/",
    "https://www.cesantoni.com.mx/producto/mutina-perlino/",
    "https://www.cesantoni.com.mx/producto/casablanca/",
    "https://www.cesantoni.com.mx/producto/piatra/",
    "https://www.cesantoni.com.mx/producto/cotto-loreto/",
    "https://www.cesantoni.com.mx/producto/harlem/",
    "https://www.cesantoni.com.mx/producto/riviera/",
    "https://www.cesantoni.com.mx/producto/peninsula-oxford/",
    "https://www.cesantoni.com.mx/producto/napoli/",
    "https://www.cesantoni.com.mx/producto/kingston/",
    "https://www.cesantoni.com.mx/producto/belmonte/",
    "https://www.cesantoni.com.mx/producto/ravelo/",
    "https://www.cesantoni.com.mx/producto/giardino/",
    "https://www.cesantoni.com.mx/producto/botticelli/",
    "https://www.cesantoni.com.mx/producto/verttoni/",
    "https://www.cesantoni.com.mx/producto/mazarello/",
    "https://www.cesantoni.com.mx/producto/mare/",
    "https://www.cesantoni.com.mx/producto/bottura-latte/",
    "https://www.cesantoni.com.mx/producto/celle-blanc/",
    "https://www.cesantoni.com.mx/producto/domain/",
    "https://www.cesantoni.com.mx/producto/fontana/",
    "https://www.cesantoni.com.mx/producto/piave/",
    "https://www.cesantoni.com.mx/producto/kampala/",
    "https://www.cesantoni.com.mx/producto/pangea/",
    "https://www.cesantoni.com.mx/producto/livia/",
    "https://www.cesantoni.com.mx/producto/coral-shell/",
    "https://www.cesantoni.com.mx/producto/caravita/",
    "https://www.cesantoni.com.mx/producto/samperi/",
    "https://www.cesantoni.com.mx/producto/marconi/",
    "https://www.cesantoni.com.mx/producto/bastille/",
    "https://www.cesantoni.com.mx/producto/silverstone/",
    "https://www.cesantoni.com.mx/producto/lightwood-2/",
    "https://www.cesantoni.com.mx/producto/bento/",
    "https://www.cesantoni.com.mx/producto/woodland/",
    "https://www.cesantoni.com.mx/producto/timberland/",
    "https://www.cesantoni.com.mx/producto/terrazo/",
    "https://www.cesantoni.com.mx/producto/sereni/",
    "https://www.cesantoni.com.mx/producto/harlow/",
    "https://www.cesantoni.com.mx/producto/fiore/",
    "https://www.cesantoni.com.mx/producto/britton/",
    "https://www.cesantoni.com.mx/producto/amberwood/",
    "https://www.cesantoni.com.mx/producto/montebello/",
    "https://www.cesantoni.com.mx/producto/valentino/",
    "https://www.cesantoni.com.mx/producto/vicenzo/",
    "https://www.cesantoni.com.mx/producto/frattino/",
    "https://www.cesantoni.com.mx/producto/milena/",
    "https://www.cesantoni.com.mx/producto/nekk/",
    "https://www.cesantoni.com.mx/producto/riverwood/",
    "https://www.cesantoni.com.mx/producto/santo-tomas/",
    "https://www.cesantoni.com.mx/producto/porto-santo/",
    "https://www.cesantoni.com.mx/producto/travali/",
    "https://www.cesantoni.com.mx/producto/stockton/",
    "https://www.cesantoni.com.mx/producto/nebraska/",
    "https://www.cesantoni.com.mx/producto/mylo/",
    "https://www.cesantoni.com.mx/producto/trenton/",
    "https://www.cesantoni.com.mx/producto/piamont/",
    "https://www.cesantoni.com.mx/producto/padova/",
    "https://www.cesantoni.com.mx/producto/nouvelle/",
    "https://www.cesantoni.com.mx/producto/moncler/",
    "https://www.cesantoni.com.mx/producto/monte-carlo/",
    "https://www.cesantoni.com.mx/producto/memphis/",
    "https://www.cesantoni.com.mx/producto/martel-gray/",
    "https://www.cesantoni.com.mx/producto/santorini/",
    "https://www.cesantoni.com.mx/producto/vermont/",
    "https://www.cesantoni.com.mx/producto/valenzi/",
    "https://www.cesantoni.com.mx/producto/napa/",
    "https://www.cesantoni.com.mx/producto/veleta/",
    "https://www.cesantoni.com.mx/producto/zadar/",
    "https://www.cesantoni.com.mx/producto/volterra/",
    "https://www.cesantoni.com.mx/producto/lemek/",
    "https://www.cesantoni.com.mx/producto/helsinki-sg/",
    "https://www.cesantoni.com.mx/producto/hanover/",
    "https://www.cesantoni.com.mx/producto/gaudi/",
    "https://www.cesantoni.com.mx/producto/frau/",
    "https://www.cesantoni.com.mx/producto/elkwood/",
    "https://www.cesantoni.com.mx/producto/edimburgo/",
    "https://www.cesantoni.com.mx/producto/denver/",
    "https://www.cesantoni.com.mx/producto/decker/",
    "https://www.cesantoni.com.mx/producto/daytona-estructurado/",
    "https://www.cesantoni.com.mx/producto/cuori/",
    "https://www.cesantoni.com.mx/producto/charlot/",
    "https://www.cesantoni.com.mx/producto/cannon-wood/",
    "https://www.cesantoni.com.mx/producto/calajan/",
    "https://www.cesantoni.com.mx/producto/botev-sg/",
    "https://www.cesantoni.com.mx/producto/blendwood/",
    "https://www.cesantoni.com.mx/producto/ardem/",
    "https://www.cesantoni.com.mx/producto/aranza/",
    "https://www.cesantoni.com.mx/producto/andrea/",
    "https://www.cesantoni.com.mx/producto/astor/",
    "https://www.cesantoni.com.mx/producto/lanz/",
    "https://www.cesantoni.com.mx/producto/atis-piedra/",
    "https://www.cesantoni.com.mx/producto/kiel/",
    "https://www.cesantoni.com.mx/producto/alabama/",
    "https://www.cesantoni.com.mx/producto/leighton/",
]

headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
}

def extract_slug(url):
    """Extrae el slug del URL"""
    match = re.search(r'/producto/([^/]+)/', url)
    return match.group(1) if match else None

def scrape_product(url):
    """Extrae información de un producto"""
    slug = extract_slug(url)
    print(f"  Scrapeando: {slug}...", end=" ", flush=True)
    
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code != 200:
            print(f"❌ Status {resp.status_code}")
            return None
            
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        product = {
            'slug': slug,
            'url': url,
            'name': None,
            'sku': None,
            'category': None,
            'format': None,
            'finish': None,
            'type': None,
            'usage': None,
            'pieces_per_box': None,
            'sqm_per_box': None,
            'image_url': None,
            'images': [],
            'specs': {}
        }
        
        # Nombre del producto
        h1 = soup.find('h1')
        if h1:
            product['name'] = h1.text.strip()
        
        # Buscar imagen principal
        # Intentar diferentes selectores comunes
        img_selectors = [
            'img.wp-post-image',
            '.product-image img',
            '.woocommerce-product-gallery img',
            'img[src*="producto"]',
            'img[src*="cesantoni"]',
            '.elementor-widget-image img',
            'figure img',
        ]
        
        for selector in img_selectors:
            img = soup.select_one(selector)
            if img:
                src = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
                if src and ('cesantoni' in src or 'wp-content' in src):
                    product['image_url'] = src
                    break
        
        # Buscar todas las imágenes del producto
        all_imgs = soup.find_all('img')
        for img in all_imgs:
            src = img.get('src') or img.get('data-src') or img.get('data-lazy-src')
            if src and ('cesantoni' in src or 'wp-content' in src) and 'producto' in src.lower():
                if src not in product['images']:
                    product['images'].append(src)
        
        # Buscar especificaciones en tablas
        tables = soup.find_all('table')
        for table in tables:
            rows = table.find_all('tr')
            for row in rows:
                cells = row.find_all(['td', 'th'])
                if len(cells) >= 2:
                    key = cells[0].text.strip().lower()
                    value = cells[1].text.strip()
                    product['specs'][key] = value
                    
                    # Mapear a campos conocidos
                    if 'formato' in key or 'size' in key:
                        product['format'] = value
                    elif 'sku' in key or 'código' in key or 'codigo' in key:
                        product['sku'] = value
                    elif 'acabado' in key or 'finish' in key:
                        product['finish'] = value
                    elif 'tipo' in key or 'type' in key:
                        product['type'] = value
                    elif 'uso' in key or 'usage' in key:
                        product['usage'] = value
                    elif 'piezas' in key:
                        try:
                            product['pieces_per_box'] = int(re.search(r'\d+', value).group())
                        except:
                            pass
                    elif 'm2' in key or 'm²' in key or 'metros' in key:
                        try:
                            product['sqm_per_box'] = float(re.search(r'[\d.]+', value).group())
                        except:
                            pass
        
        # Buscar especificaciones en listas/divs
        spec_divs = soup.find_all(['div', 'ul', 'dl'], class_=lambda x: x and ('spec' in str(x).lower() or 'detail' in str(x).lower() or 'caracteristica' in str(x).lower()))
        for div in spec_divs:
            text = div.get_text(separator='\n')
            lines = text.split('\n')
            for i, line in enumerate(lines):
                line = line.strip()
                if ':' in line:
                    parts = line.split(':', 1)
                    if len(parts) == 2:
                        key = parts[0].strip().lower()
                        value = parts[1].strip()
                        if key and value:
                            product['specs'][key] = value
        
        # Generar SKU si no se encontró
        if not product['sku'] and product['name']:
            # Crear SKU basado en nombre
            name_parts = product['name'].upper().replace(' ', '-')[:15]
            product['sku'] = f"CES-{name_parts}"
        
        print(f"✅ {product['name'] or slug}")
        return product
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def main():
    print("=" * 60)
    print("🏠 SCRAPER CESANTONI - Extrayendo productos")
    print("=" * 60)
    print(f"Total URLs: {len(PRODUCT_URLS)}")
    print()
    
    products = []
    errors = []
    
    for i, url in enumerate(PRODUCT_URLS, 1):
        print(f"[{i}/{len(PRODUCT_URLS)}]", end=" ")
        product = scrape_product(url)
        
        if product:
            products.append(product)
        else:
            errors.append(url)
        
        # Pausa para no saturar el servidor
        time.sleep(1)
    
    print()
    print("=" * 60)
    print(f"✅ Productos extraídos: {len(products)}")
    print(f"❌ Errores: {len(errors)}")
    
    # Guardar JSON
    output_file = 'productos_cesantoni.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, indent=2)
    
    print(f"\n📁 Guardado en: {output_file}")
    
    # Mostrar resumen
    print("\n--- RESUMEN ---")
    for p in products[:5]:
        print(f"  • {p['name']} ({p['sku']}) - {p['format'] or 'Sin formato'}")
    if len(products) > 5:
        print(f"  ... y {len(products) - 5} más")
    
    if errors:
        print("\n--- ERRORES ---")
        for url in errors:
            print(f"  • {url}")
    
    print("\n✅ Listo! Ahora sube 'productos_cesantoni.json' a Claude para importar a la DB")

if __name__ == '__main__':
    main()
