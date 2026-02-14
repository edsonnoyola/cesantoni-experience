#!/usr/bin/env python3
"""
Scrape cesantoni.com.mx to find close-up tile images (C1 images) for products
that are missing them in the CRM database.

Strategy:
1. Fetch all products from the Render API
2. Identify those without _C1 images in their gallery
3. For each, try multiple approaches to find the C1 image:
   a. Scrape the product page on cesantoni.com.mx
   b. Try constructing C1 URLs from known naming patterns
   c. Try HEAD requests to verify constructed URLs exist
4. Output results to tile-images.json
"""

import ssl
import urllib.request
import urllib.error
import json
import re
import time
import os
import sys

# --- Configuration ---
API_URL = "https://cesantoni-experience-za74.onrender.com/api/products"
BASE_SITE = "https://www.cesantoni.com.mx"
PRODUCT_URL_TEMPLATE = BASE_SITE + "/producto/{slug}/"
WP_UPLOADS = BASE_SITE + "/wp-content/uploads/"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "tile-images.json")
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# SSL context that skips verification (needed for this environment)
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE


def fetch_url(url, timeout=20):
    """Fetch a URL and return the response body as string. Returns None on error."""
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", USER_AGENT)
        resp = urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx)
        return resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, Exception) as e:
        return None


def head_url(url, timeout=10):
    """Check if a URL exists via HEAD request. Returns True if status 200."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        req.add_header("User-Agent", USER_AGENT)
        resp = urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx)
        return resp.status == 200
    except Exception:
        # Some servers reject HEAD, try GET with range
        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", USER_AGENT)
            req.add_header("Range", "bytes=0-0")
            resp = urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx)
            return resp.status in (200, 206)
        except Exception:
            return False


def extract_c1_images_from_html(html):
    """Extract all image URLs containing _C1 from HTML content."""
    pattern = r'https?://[^\s"\'<>]+?_C1[^\s"\'<>]*\.(?:jpg|jpeg|png|webp)'
    matches = re.findall(pattern, html, re.IGNORECASE)
    return list(set(matches))


def filter_own_c1(images, product_name):
    """Filter C1 images to only those matching the product name."""
    name_upper = product_name.upper().strip()
    name_underscore = name_upper.replace(" ", "_")
    name_nospace = name_upper.replace(" ", "")

    results = []
    for img in images:
        img_upper = img.upper()
        if name_underscore in img_upper or name_nospace in img_upper:
            results.append(img)

    return results


def get_best_c1(images):
    """From a list of C1 image URLs, pick the best one (prefer full size, no resize suffix)."""
    if not images:
        return None

    scored = []
    for img in images:
        score = 0
        # Prefer exact _C1 (not _C12, _C14, etc.)
        if re.search(r'_C1[^0-9]', img) or re.search(r'_C1\.(jpg|jpeg|png|webp)', img, re.IGNORECASE):
            score += 100
        elif re.search(r'_C1-', img):
            score += 90  # _C1-1, _C1-e... are still C1
        # Penalize resized versions (e.g., -1024x512, -300x150)
        if re.search(r'-\d+x\d+\.', img):
            score -= 50
        # Prefer no double-slash in path
        cleaned = img.replace("https://", "").replace("http://", "")
        if "//" not in cleaned:
            score += 10
        # Prefer .jpg
        if img.lower().endswith('.jpg') or img.lower().endswith('.jpeg'):
            score += 5
        elif img.lower().endswith('.webp'):
            score += 3
        scored.append((score, img))

    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


def normalize_format(fmt):
    """Normalize format string for URL construction: '20 x 120 cm' -> '20x120cm'"""
    if not fmt:
        return None
    fmt = fmt.strip()
    fmt = re.sub(r'\s*x\s*', 'x', fmt, flags=re.IGNORECASE)
    fmt = re.sub(r'\s*cm\s*', 'cm', fmt, flags=re.IGNORECASE)
    fmt = re.sub(r'\s*CM\s*', 'cm', fmt, flags=re.IGNORECASE)
    fmt = fmt.replace(" ", "")
    fmt = re.sub(r'cm$', 'cm', fmt, flags=re.IGNORECASE)
    return fmt


def construct_c1_candidates(product_name, product_format):
    """Construct possible C1 URL candidates based on naming conventions."""
    candidates = []
    name = product_name.upper().replace(" ", "_")
    fmt = normalize_format(product_format)

    extensions = [".jpg", ".webp", ".png", ".jpeg"]

    # Pattern 1: NAME_FORMATcm_C1.ext
    if fmt:
        for ext in extensions:
            candidates.append(f"{WP_UPLOADS}{name}_{fmt}_C1{ext}")

    # Pattern 2: NAME_C1.ext (no format)
    for ext in extensions:
        candidates.append(f"{WP_UPLOADS}{name}_C1{ext}")

    # Pattern 3: With -1 suffix
    if fmt:
        for ext in extensions:
            candidates.append(f"{WP_UPLOADS}{name}_{fmt}_C1-1{ext}")

    # Pattern 4: Capitalized name (e.g., Calacatta_Black)
    name_title = "_".join(w.capitalize() for w in product_name.split())
    if name_title != name:
        if fmt:
            for ext in extensions:
                candidates.append(f"{WP_UPLOADS}{name_title}_{fmt}_C1{ext}")
        for ext in extensions:
            candidates.append(f"{WP_UPLOADS}{name_title}_C1{ext}")

    # Pattern 5: Original casing with underscores
    name_orig = product_name.replace(" ", "_")
    if name_orig != name and name_orig != name_title:
        if fmt:
            for ext in extensions:
                candidates.append(f"{WP_UPLOADS}{name_orig}_{fmt}_C1{ext}")
        for ext in extensions:
            candidates.append(f"{WP_UPLOADS}{name_orig}_C1{ext}")

    return candidates


def scrape_product_page(slug, product_name):
    """Scrape a product page for C1 images matching the product name."""
    if not slug:
        return None

    url = PRODUCT_URL_TEMPLATE.format(slug=slug)
    html = fetch_url(url, timeout=25)
    if not html:
        return None

    all_c1 = extract_c1_images_from_html(html)
    own_c1 = filter_own_c1(all_c1, product_name)

    if own_c1:
        return get_best_c1(own_c1)

    return None


def try_constructed_urls(product_name, product_format):
    """Try constructed C1 URLs via HEAD requests."""
    candidates = construct_c1_candidates(product_name, product_format)

    for url in candidates:
        if head_url(url):
            return url
        time.sleep(0.15)

    return None


def main():
    print("=" * 70)
    print("CESANTONI C1 TILE IMAGE SCRAPER")
    print("=" * 70)
    print()

    # Step 1: Fetch all products
    print("[1/4] Fetching products from API...")
    html = fetch_url(API_URL, timeout=30)
    if not html:
        print("ERROR: Could not fetch products from API")
        sys.exit(1)

    products = json.loads(html)
    print(f"      Found {len(products)} total products")

    # Step 2: Identify products without C1
    print("[2/4] Identifying products without C1 images...")
    missing_c1 = []
    has_c1_count = 0

    for p in products:
        gallery = p.get("gallery", "[]")
        if isinstance(gallery, str):
            try:
                gallery = json.loads(gallery)
            except (json.JSONDecodeError, TypeError):
                gallery = []
        if not gallery:
            gallery = []

        found = False
        for img in gallery:
            if "_C1" in img:
                found = True
                break

        if found:
            has_c1_count += 1
        else:
            missing_c1.append(p)

    print(f"      {has_c1_count} products already have C1 images")
    print(f"      {len(missing_c1)} products are MISSING C1 images")
    print()

    # Step 3: Scrape for C1 images
    print("[3/4] Scraping for C1 images...")
    print("-" * 70)

    results = {}
    found_count = 0
    not_found = []

    for i, product in enumerate(missing_c1):
        pid = product["id"]
        name = product["name"]
        slug = product.get("slug")
        fmt = product.get("format", "")

        progress = f"[{i+1}/{len(missing_c1)}]"
        print(f"  {progress} {name} (id={pid}, slug={slug}, format={fmt})")

        c1_url = None

        # Strategy A: Scrape the product page
        if slug:
            c1_url = scrape_product_page(slug, name)
            if c1_url:
                print(f"         FOUND (page scrape): {c1_url}")

        # Strategy B: Try constructed URLs via HEAD requests
        if not c1_url:
            c1_url = try_constructed_urls(name, fmt)
            if c1_url:
                print(f"         FOUND (URL probe): {c1_url}")

        # Strategy C: Try alternate slug variants for page scrape
        if not c1_url and slug:
            alt_name = name.lower().strip().replace(" ", "-")
            alt_name = re.sub(r'[^a-z0-9-]', '', alt_name)
            alt_name = re.sub(r'-+', '-', alt_name).strip('-')
            if alt_name != slug:
                c1_url = scrape_product_page(alt_name, name)
                if c1_url:
                    print(f"         FOUND (alt slug '{alt_name}'): {c1_url}")

        # Strategy D: Broader search on page - try partial name matching
        if not c1_url and slug:
            url = PRODUCT_URL_TEMPLATE.format(slug=slug)
            page_html = fetch_url(url, timeout=25)
            if page_html:
                all_c1 = extract_c1_images_from_html(page_html)
                # Try matching with just the first word of the product name
                first_word = name.split()[0].upper()
                if len(first_word) >= 4:
                    partial_matches = [img for img in all_c1 if first_word in img.upper()]
                    if partial_matches:
                        c1_url = get_best_c1(partial_matches)
                        if c1_url:
                            print(f"         FOUND (partial match): {c1_url}")

        # Strategy E: For Malla/Paver products, try parent product name
        if not c1_url and not slug:
            # e.g., "Alpes Malla" -> try "ALPES" C1
            parts = name.split()
            if len(parts) >= 2 and parts[-1] in ("Malla", "Paver"):
                parent_name = " ".join(parts[:-1])
                c1_url = try_constructed_urls(parent_name, fmt)
                if c1_url:
                    print(f"         FOUND (parent '{parent_name}' probe): {c1_url}")

        if c1_url:
            results[str(pid)] = c1_url
            found_count += 1
        else:
            not_found.append({"id": pid, "name": name, "slug": slug, "format": fmt})
            print(f"         NOT FOUND")

        # Rate limiting - be respectful
        time.sleep(0.5)

    print("-" * 70)
    print()

    # Step 4: Save results
    print("[4/4] Saving results...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"      Saved to: {OUTPUT_FILE}")
    print()

    # Summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"  Total products:           {len(products)}")
    print(f"  Already had C1:           {has_c1_count}")
    print(f"  Missing C1 (searched):    {len(missing_c1)}")
    print(f"  C1 images FOUND:          {found_count}")
    print(f"  C1 images NOT FOUND:      {len(not_found)}")
    print()

    if results:
        print("FOUND C1 images:")
        for pid, url in results.items():
            pname = next((p["name"] for p in products if str(p["id"]) == pid), "?")
            print(f"  id={pid} ({pname}): {url}")
        print()

    if not_found:
        print("Still missing C1 images:")
        for item in not_found:
            print(f"  id={item['id']} ({item['name']}) [slug={item['slug']}, format={item['format']}]")
        print()

    print(f"Results written to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
