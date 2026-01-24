#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'public/index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Verificar si ya tiene promociones
if (html.includes('page-promociones')) {
  console.log('⚠️  Ya tiene la sección de promociones');
  process.exit(0);
}

// 1. Agregar nav items después de QR
const navInsert = `
        <div class="nav-item" onclick="showPage('promociones')">💰 Promociones</div>
        <div class="nav-item" onclick="showPage('landings')">📄 Ver Landings</div>`;

html = html.replace(
  `<div class="nav-item" onclick="showPage('qr')">📱 Generar QR</div>`,
  `<div class="nav-item" onclick="showPage('qr')">📱 Generar QR</div>${navInsert}`
);

// 2. Agregar páginas antes de </main>
const pagesInsert = `
        <!-- Promociones -->
        <div id="page-promociones" class="page">
            <div class="header"><h2>Promociones</h2></div>
            
            <div class="card">
                <h3>➕ Crear Promoción</h3>
                <div class="promo-filters">
                    <div class="filter-section">
                        <div class="filter-header"><span class="filter-label">1. Productos</span><div><button class="chip-btn" onclick="promoSelectAll('product')">Todos</button><button class="chip-btn" onclick="promoSelectNone('product')">Ninguno</button></div></div>
                        <div class="filter-grid" id="promo-products"></div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-header"><span class="filter-label">2. Distribuidores</span><div><button class="chip-btn" onclick="promoSelectAll('dist')">Todos</button><button class="chip-btn" onclick="promoSelectNone('dist')">Ninguno</button></div></div>
                        <div class="filter-grid" id="promo-dists"></div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-header"><span class="filter-label">3. Estados</span><div><button class="chip-btn" onclick="promoSelectAll('state')">Todos</button><button class="chip-btn" onclick="promoSelectNone('state')">Ninguno</button></div></div>
                        <div class="filter-grid" id="promo-states"></div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-header"><span class="filter-label">4. Ciudades</span><div><button class="chip-btn" onclick="promoSelectAll('city')">Todas</button><button class="chip-btn" onclick="promoSelectNone('city')">Ninguna</button></div></div>
                        <div class="filter-grid" id="promo-cities"></div>
                    </div>
                    <div class="filter-section">
                        <div class="filter-header"><span class="filter-label">5. Tiendas</span><div><button class="chip-btn" onclick="promoSelectAll('store')">Todas</button><button class="chip-btn" onclick="promoSelectNone('store')">Ninguna</button></div></div>
                        <div class="filter-grid" id="promo-stores"></div>
                    </div>
                </div>
                
                <div class="promo-summary">
                    <div><span class="big" id="promo-cnt-prod">0</span><br>Productos</div>
                    <div><span class="big" id="promo-cnt-store">0</span><br>Tiendas</div>
                    <div><span class="big" id="promo-cnt-total">0</span><br>Promos</div>
                </div>
                
                <div class="promo-form">
                    <input type="text" id="promo-name" placeholder="Nombre (ej: Hot Sale 2026)">
                    <input type="number" id="promo-price" placeholder="Precio $">
                    <input type="text" id="promo-text" placeholder="Texto landing">
                    <input type="date" id="promo-start">
                    <input type="date" id="promo-end">
                </div>
                <div style="display:flex;gap:10px;margin-top:16px">
                    <button class="btn btn-secondary" onclick="resetPromoForm()">Limpiar</button>
                    <button class="btn btn-primary" onclick="createPromos()">Crear Promociones</button>
                </div>
            </div>
            
            <div class="card">
                <h3>📋 Gestionar (<span id="promo-total">0</span> promociones)</h3>
                <div class="promo-filters-inline">
                    <select id="manage-dist" onchange="renderPromoList()"><option value="">Todos distribuidores</option></select>
                    <select id="manage-state" onchange="renderPromoList()"><option value="">Todos estados</option></select>
                </div>
                <div id="promo-list"></div>
            </div>
        </div>
        
        <!-- Landings -->
        <div id="page-landings" class="page">
            <div class="header"><h2>Preview Landings</h2></div>
            <div class="card">
                <div class="promo-filters-inline">
                    <select id="landing-dist" onchange="renderLandings()"><option value="">Todos distribuidores</option></select>
                    <select id="landing-state" onchange="renderLandings()"><option value="">Todos estados</option></select>
                </div>
                <div class="landing-grid" id="landing-grid"></div>
            </div>
        </div>
`;

html = html.replace('</main>', pagesInsert + '\n    </main>');

// 3. Agregar estilos antes de </style>
const stylesInsert = `
        /* Promociones */
        .promo-filters { display: flex; flex-direction: column; gap: 16px; }
        .filter-section { padding-bottom: 12px; border-bottom: 1px solid #eee; }
        .filter-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .filter-label { font-weight: 600; font-size: 0.85rem; color: #666; }
        .filter-grid { display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto; }
        .filter-chip2 { padding: 6px 12px; background: #f5f5f5; border: 2px solid transparent; border-radius: 6px; font-size: 0.8rem; cursor: pointer; display: flex; align-items: center; gap: 6px; }
        .filter-chip2:hover { background: #eee; }
        .filter-chip2.selected { background: #e8f5e9; border-color: var(--green); }
        .filter-chip2 .cnt { background: #ddd; padding: 1px 6px; border-radius: 8px; font-size: 0.7rem; }
        .chip-btn { padding: 4px 8px; font-size: 0.7rem; background: #eee; border: none; border-radius: 4px; cursor: pointer; margin-left: 4px; }
        
        .promo-summary { display: flex; justify-content: space-around; background: var(--green); color: white; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center; }
        .promo-summary .big { font-size: 2rem; font-weight: 700; }
        
        .promo-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
        .promo-form input { padding: 10px; border: 1px solid #ddd; border-radius: 6px; }
        
        .promo-filters-inline { display: flex; gap: 10px; margin-bottom: 16px; }
        .promo-filters-inline select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; }
        
        .promo-group { border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
        .promo-group-header { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #fafafa; cursor: pointer; }
        .promo-group-header:hover { background: #f5f5f5; }
        .promo-group-items { display: none; }
        .promo-group.open .promo-group-items { display: block; }
        .promo-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-top: 1px solid #eee; font-size: 0.85rem; }
        .promo-item:hover { background: #fafafa; }
        .promo-price { font-weight: 700; color: var(--green); }
        .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
        .badge-on { background: #d4edda; color: #155724; }
        .badge-off { background: #f8d7da; color: #721c24; }
        
        .landing-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
        .landing-card { background: white; border: 1px solid #eee; border-radius: 10px; overflow: hidden; cursor: pointer; transition: all 0.2s; }
        .landing-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-2px); }
        .landing-card-img { height: 100px; background: #f5f5f5 center/cover; }
        .landing-card-body { padding: 12px; }
        .landing-card-body h4 { font-size: 0.9rem; margin-bottom: 4px; }
        .landing-card-body p { font-size: 0.75rem; color: #888; }
        .landing-card-body .price { font-size: 1.2rem; font-weight: 700; color: var(--green); margin-top: 8px; }
`;

html = html.replace('</style>', stylesInsert + '\n    </style>');

// 4. Agregar JavaScript antes de </script>
const jsInsert = `
        
        // ==================== PROMOCIONES ====================
        let promoProducts = [], promoStores = [], promoPromotions = [];
        let promoSelected = { product: new Set(), dist: new Set(), state: new Set(), city: new Set(), store: new Set() };
        
        async function loadPromoData() {
            const [p, s, pr] = await Promise.all([
                fetch('/api/products').then(r => r.json()),
                fetch('/api/stores').then(r => r.json()),
                fetch('/api/promotions').then(r => r.json())
            ]);
            promoProducts = p; promoStores = s; promoPromotions = pr;
            renderPromoFilters();
            renderPromoList();
            renderLandingFilters();
            
            // Set default dates
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('promo-start').value = today;
            const next = new Date(); next.setMonth(next.getMonth() + 1);
            document.getElementById('promo-end').value = next.toISOString().split('T')[0];
        }
        
        function renderPromoFilters() {
            // Products
            document.getElementById('promo-products').innerHTML = promoProducts.map(p => 
                \`<div class="filter-chip2 \${promoSelected.product.has(p.id)?'selected':''}" onclick="promoToggle('product',\${p.id})">\${p.name}</div>\`
            ).join('');
            
            // Distributors
            const dists = [...new Set(promoStores.map(s => s.distributor_name))].filter(Boolean).sort();
            const distCounts = {};
            promoStores.forEach(s => distCounts[s.distributor_name] = (distCounts[s.distributor_name]||0)+1);
            document.getElementById('promo-dists').innerHTML = dists.map(d => 
                \`<div class="filter-chip2 \${promoSelected.dist.has(d)?'selected':''}" onclick="promoToggle('dist','\${d}')">\${d} <span class="cnt">\${distCounts[d]}</span></div>\`
            ).join('');
            
            // States (filtered by dist)
            let filtered = promoStores;
            if (promoSelected.dist.size) filtered = filtered.filter(s => promoSelected.dist.has(s.distributor_name));
            const states = [...new Set(filtered.map(s => s.state))].filter(Boolean).sort();
            const stateCounts = {};
            filtered.forEach(s => { if(s.state) stateCounts[s.state] = (stateCounts[s.state]||0)+1; });
            document.getElementById('promo-states').innerHTML = states.map(st => 
                \`<div class="filter-chip2 \${promoSelected.state.has(st)?'selected':''}" onclick="promoToggle('state','\${st}')">\${st} <span class="cnt">\${stateCounts[st]}</span></div>\`
            ).join('') || '<span style="color:#999;font-size:0.8rem">Selecciona distribuidores</span>';
            
            // Cities (filtered by dist + state)
            if (promoSelected.state.size) filtered = filtered.filter(s => promoSelected.state.has(s.state));
            const cities = [...new Set(filtered.map(s => s.city))].filter(Boolean).sort();
            const cityCounts = {};
            filtered.forEach(s => { if(s.city) cityCounts[s.city] = (cityCounts[s.city]||0)+1; });
            document.getElementById('promo-cities').innerHTML = cities.map(c => 
                \`<div class="filter-chip2 \${promoSelected.city.has(c)?'selected':''}" onclick="promoToggle('city','\${c}')">\${c} <span class="cnt">\${cityCounts[c]}</span></div>\`
            ).join('') || '<span style="color:#999;font-size:0.8rem">Selecciona estados</span>';
            
            // Stores (filtered)
            if (promoSelected.city.size) filtered = filtered.filter(s => promoSelected.city.has(s.city));
            document.getElementById('promo-stores').innerHTML = filtered.slice(0,60).map(s => 
                \`<div class="filter-chip2 \${promoSelected.store.has(s.id)?'selected':''}" onclick="promoToggle('store',\${s.id})">\${s.name}</div>\`
            ).join('') || '<span style="color:#999;font-size:0.8rem">No hay tiendas</span>';
            
            updatePromoCounts();
            
            // Manage filters
            document.getElementById('manage-dist').innerHTML = '<option value="">Todos distribuidores</option>' + dists.map(d => \`<option>\${d}</option>\`).join('');
            document.getElementById('manage-state').innerHTML = '<option value="">Todos estados</option>' + [...new Set(promoStores.map(s=>s.state))].filter(Boolean).sort().map(s => \`<option>\${s}</option>\`).join('');
        }
        
        function promoToggle(type, val) {
            promoSelected[type].has(val) ? promoSelected[type].delete(val) : promoSelected[type].add(val);
            if (type === 'dist') { promoSelected.state.clear(); promoSelected.city.clear(); promoSelected.store.clear(); }
            if (type === 'state') { promoSelected.city.clear(); promoSelected.store.clear(); }
            if (type === 'city') promoSelected.store.clear();
            renderPromoFilters();
        }
        
        function promoSelectAll(type) {
            if (type === 'product') promoProducts.forEach(p => promoSelected.product.add(p.id));
            else if (type === 'store') getFilteredPromoStores().forEach(s => promoSelected.store.add(s.id));
            else document.querySelectorAll(\`#promo-\${type}s .filter-chip2\`).forEach(el => {
                const txt = el.textContent.trim().split(/\\s+/)[0];
                promoSelected[type].add(type === 'dist' ? txt : txt);
            });
            renderPromoFilters();
        }
        
        function promoSelectNone(type) {
            promoSelected[type].clear();
            if (type === 'dist') { promoSelected.state.clear(); promoSelected.city.clear(); promoSelected.store.clear(); }
            if (type === 'state') { promoSelected.city.clear(); promoSelected.store.clear(); }
            if (type === 'city') promoSelected.store.clear();
            renderPromoFilters();
        }
        
        function getFilteredPromoStores() {
            let f = promoStores;
            if (promoSelected.dist.size) f = f.filter(s => promoSelected.dist.has(s.distributor_name));
            if (promoSelected.state.size) f = f.filter(s => promoSelected.state.has(s.state));
            if (promoSelected.city.size) f = f.filter(s => promoSelected.city.has(s.city));
            return f;
        }
        
        function getSelectedPromoStoreIds() {
            return promoSelected.store.size ? Array.from(promoSelected.store) : getFilteredPromoStores().map(s => s.id);
        }
        
        function updatePromoCounts() {
            const p = promoSelected.product.size, s = getSelectedPromoStoreIds().length;
            document.getElementById('promo-cnt-prod').textContent = p;
            document.getElementById('promo-cnt-store').textContent = s;
            document.getElementById('promo-cnt-total').textContent = p * s;
        }
        
        async function createPromos() {
            const name = document.getElementById('promo-name').value;
            const price = document.getElementById('promo-price').value;
            const text = document.getElementById('promo-text').value;
            const start = document.getElementById('promo-start').value;
            const end = document.getElementById('promo-end').value;
            
            if (!name || !price || !start || !end) return alert('Completa todos los campos');
            if (!promoSelected.product.size) return alert('Selecciona productos');
            const storeIds = getSelectedPromoStoreIds();
            if (!storeIds.length) return alert('Selecciona tiendas');
            
            let created = 0;
            for (const pid of promoSelected.product) {
                for (const sid of storeIds) {
                    const store = promoStores.find(s => s.id === sid);
                    await fetch('/api/promotions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, product_id: pid, scope_type: 'store', scope_value: store.slug, promo_price: +price, promo_text: text, start_date: start, end_date: end })
                    });
                    created++;
                }
            }
            alert(\`✅ \${created} promociones creadas\`);
            resetPromoForm();
            loadPromoData();
        }
        
        function resetPromoForm() {
            ['promo-name', 'promo-price', 'promo-text'].forEach(id => document.getElementById(id).value = '');
            Object.keys(promoSelected).forEach(k => promoSelected[k].clear());
            renderPromoFilters();
        }
        
        function renderPromoList() {
            const distF = document.getElementById('manage-dist').value;
            const stateF = document.getElementById('manage-state').value;
            
            let filtered = promoPromotions.filter(p => {
                const store = promoStores.find(s => s.slug === p.scope_value);
                if (distF && store?.distributor_name !== distF) return false;
                if (stateF && store?.state !== stateF) return false;
                return true;
            });
            
            document.getElementById('promo-total').textContent = promoPromotions.length;
            
            if (!filtered.length) {
                document.getElementById('promo-list').innerHTML = '<p style="color:#999;text-align:center;padding:20px">No hay promociones</p>';
                return;
            }
            
            const groups = {};
            filtered.forEach(p => {
                const store = promoStores.find(s => s.slug === p.scope_value);
                const key = store?.distributor_name || 'Otro';
                if (!groups[key]) groups[key] = [];
                groups[key].push({ ...p, store });
            });
            
            document.getElementById('promo-list').innerHTML = Object.entries(groups).map(([dist, promos]) => \`
                <div class="promo-group" onclick="this.classList.toggle('open')">
                    <div class="promo-group-header">
                        <span><strong>\${dist}</strong> <span class="badge badge-on">\${promos.length}</span></span>
                        <div>
                            <button class="btn btn-primary" style="padding:4px 10px;font-size:0.75rem" onclick="event.stopPropagation();togglePromoGroup('\${dist}',true)">Activar</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.75rem" onclick="event.stopPropagation();togglePromoGroup('\${dist}',false)">Desactivar</button>
                        </div>
                    </div>
                    <div class="promo-group-items">
                        \${promos.map(p => \`
                            <div class="promo-item">
                                <div>
                                    <strong>\${p.product_name || 'Producto'}</strong> <span class="badge \${p.active?'badge-on':'badge-off'}">\${p.active?'ON':'OFF'}</span><br>
                                    <small style="color:#888">\${p.store?.name || p.scope_value}</small>
                                </div>
                                <div style="display:flex;align-items:center;gap:10px">
                                    <span class="promo-price">$\${p.promo_price}</span>
                                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:0.7rem" onclick="event.stopPropagation();openLandingPreview('\${p.product_sku}','\${p.scope_value}')">👁️</button>
                                    <button class="btn \${p.active?'btn-secondary':'btn-primary'}" style="padding:4px 8px;font-size:0.7rem" onclick="event.stopPropagation();toggleSinglePromo(\${p.id})">\${p.active?'Off':'On'}</button>
                                </div>
                            </div>
                        \`).join('')}
                    </div>
                </div>
            \`).join('');
        }
        
        async function togglePromoGroup(dist, activate) {
            const promos = promoPromotions.filter(p => {
                const store = promoStores.find(s => s.slug === p.scope_value);
                return store?.distributor_name === dist && p.active !== activate;
            });
            for (const p of promos) await fetch(\`/api/promotions/\${p.id}/toggle\`, { method: 'PUT' });
            loadPromoData();
        }
        
        async function toggleSinglePromo(id) {
            await fetch(\`/api/promotions/\${id}/toggle\`, { method: 'PUT' });
            loadPromoData();
        }
        
        // ==================== LANDINGS ====================
        function renderLandingFilters() {
            const dists = [...new Set(promoStores.map(s => s.distributor_name))].filter(Boolean).sort();
            const states = [...new Set(promoStores.map(s => s.state))].filter(Boolean).sort();
            document.getElementById('landing-dist').innerHTML = '<option value="">Todos distribuidores</option>' + dists.map(d => \`<option>\${d}</option>\`).join('');
            document.getElementById('landing-state').innerHTML = '<option value="">Todos estados</option>' + states.map(s => \`<option>\${s}</option>\`).join('');
            renderLandings();
        }
        
        function renderLandings() {
            const dist = document.getElementById('landing-dist').value;
            const state = document.getElementById('landing-state').value;
            
            const activePromos = promoPromotions.filter(p => p.active);
            let filtered = activePromos;
            if (dist || state) {
                filtered = activePromos.filter(p => {
                    const store = promoStores.find(s => s.slug === p.scope_value);
                    if (dist && store?.distributor_name !== dist) return false;
                    if (state && store?.state !== state) return false;
                    return true;
                });
            }
            
            const byProduct = {};
            filtered.forEach(p => {
                if (!byProduct[p.product_id]) byProduct[p.product_id] = { product: promoProducts.find(pr => pr.id === p.product_id), promos: [] };
                byProduct[p.product_id].promos.push(p);
            });
            
            document.getElementById('landing-grid').innerHTML = Object.values(byProduct).map(({ product, promos }) => {
                const promo = promos[0];
                return \`
                    <div class="landing-card" onclick="openLandingPreview('\${product?.slug || product?.sku}','\${promo.scope_value}')">
                        <div class="landing-card-img" style="background-image:url('\${product?.image_url || ''}')"></div>
                        <div class="landing-card-body">
                            <h4>\${product?.name || 'Producto'}</h4>
                            <p>\${promos.length} tiendas con promo</p>
                            <div class="price">$\${promo.promo_price}/m²</div>
                        </div>
                    </div>
                \`;
            }).join('') || '<p style="color:#999;text-align:center;padding:40px">No hay promociones activas</p>';
        }
        
        function openLandingPreview(sku, storeSlug) {
            if (!sku) return;
            window.open(\`/p/\${sku}?store=\${storeSlug}\`, '_blank');
        }
        
        // Load promo data when showing promo or landing pages
        const origShowPage = showPage;
        showPage = function(page) {
            origShowPage.call(this, page);
            if (page === 'promociones' || page === 'landings') loadPromoData();
        };
`;

html = html.replace('</script>', jsInsert + '\n    </script>');

// Backup and save
fs.writeFileSync(indexPath + '.backup2', fs.readFileSync(indexPath));
fs.writeFileSync(indexPath, html);

console.log('✅ Dashboard actualizado con Promociones y Landings');
console.log('Recarga: http://localhost:3000');
