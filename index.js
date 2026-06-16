const puppeteer = require('puppeteer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const delay = ms => new Promise(res => setTimeout(res, ms));

// ==========================================
// 1. SCRAPER DE MERCADOLIBRE
// ==========================================

async function obtenerDatosMercadoLibre(page, terminoBusqueda) {
    const terminoFormateado = encodeURIComponent(terminoBusqueda.trim());
    const urlObjetivo = `https://listado.mercadolibre.com.ve/${terminoFormateado}`;
    
    try {
        await page.goto(urlObjetivo, { waitUntil: 'domcontentloaded' }); 
        await page.waitForSelector('.ui-search-results, li.ui-search-layout__item', { timeout: 7000 });
        await page.evaluate(() => window.scrollBy(0, 800));
        await delay(1500);

        return await page.evaluate(() => {
            const tarjetas = document.querySelectorAll('li.ui-search-layout__item, .ui-search-result__wrapper');
            const lista = [];

            tarjetas.forEach((tarjeta, index) => {
                if (index < 20) { 
                    const linkEl = tarjeta.querySelector('a.ui-search-link') || tarjeta.querySelector('a');
                    const link = linkEl ? linkEl.href : '#';

                    const titleEl = tarjeta.querySelector('h2.ui-search-item__title') || tarjeta.querySelector('h2') || tarjeta.querySelector('h3');
                    let titulo = titleEl ? titleEl.innerText.trim() : 'Producto de MercadoLibre';

                    const imgEl = tarjeta.querySelector('.ui-search-result-image__element, img');
                    let imagenUrl = 'https://via.placeholder.com/150';
                    if (imgEl) {
                        imagenUrl = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || imgEl.src;
                    }

                    const originalEl = tarjeta.querySelector('.ui-search-price__part--small .andes-money-amount__fraction, s .andes-money-amount__fraction');
                    const actualContenedor = tarjeta.querySelector('.ui-search-price__second-line') || tarjeta.querySelector('.ui-search-price__part--medium') || tarjeta;
                    const principalEl = actualContenedor.querySelector('.andes-money-amount__fraction');

                    let precioOriginal = 'Consultar';
                    let precioOferta = 'Consultar';
                    let tieneOferta = false;

                    if (originalEl && principalEl) {
                        precioOriginal = originalEl.innerText.trim();
                        precioOferta = principalEl.innerText.trim();
                        tieneOferta = precioOriginal !== precioOferta;
                    } else if (principalEl) {
                        precioOriginal = principalEl.innerText.trim();
                        precioOferta = principalEl.innerText.trim();
                    }

                    lista.push({
                        plataforma: 'MercadoLibre',
                        producto: titulo,
                        precio_original: `$${precioOriginal}`,
                        precio_oferta: `$${precioOferta}`,
                        tiene_oferta: tieneOferta,
                        imagen: imagenUrl,
                        enlace: link
                    });
                }
            });
            return lista;
        });
    } catch (e) {
        console.log("⚠️ MercadoLibre no arrojó resultados o tardó mucho.");
        return [];
    }
}

// =========================================================================
// 2. SCRAPER DE FACEBOOK MARKETPLACE
// =========================================================================

async function obtenerDatosMarketplace(page, terminoBusqueda) {
    const terminoFormateado = encodeURIComponent(terminoBusqueda.trim());
    const urlObjetivo = `https://www.facebook.com/marketplace/caracas/search/?query=${terminoFormateado}`;
    
    try {
        await page.goto(urlObjetivo, { waitUntil: 'networkidle2' });
        await delay(4000); 
        
        await page.evaluate(() => window.scrollBy(0, 1800));
        await delay(2000);

        return await page.evaluate(() => {
            const enlacesItems = document.querySelectorAll('a[href*="/marketplace/item/"]');
            const lista = [];
            const enlacesProcesados = new Set();

            enlacesItems.forEach((enlaceA) => {
                const href = enlaceA.getAttribute('href');
                if (!href || enlacesProcesados.has(href)) return;
                enlacesProcesados.add(href);

                if (lista.length >= 25) return; 

                const link = `https://www.facebook.com${href.split('?')[0]}`;
                const imgEl = enlaceA.querySelector('img');
                const imagenUrl = imgEl ? imgEl.src : 'https://via.placeholder.com/150';

                const todosLosSpans = Array.from(enlaceA.querySelectorAll('span'));
                const textosLimpios = [...new Set(
                    todosLosSpans.map(s => s.innerText ? s.innerText.trim() : "").filter(t => t.length > 0)
                )];

                if (textosLimpios.length < 2) return; 

                let textoPrecioOficial = textosLimpios.find(t => 
                    t.startsWith('Bs.') || t.startsWith('Bs.F') || t.includes('$') || t.toLowerCase().includes('ref')
                ) || textosLimpios[0];

                let tituloFinal = textosLimpios.find(t => 
                    t !== textoPrecioOficial && 
                    !t.toLowerCase().includes('caracas') && 
                    !t.toLowerCase().includes('venezuela') &&
                    t.length > 3
                ) || "Producto de Marketplace";

                let precioNumero = parseInt(textoPrecioOficial.replace(/[^\d]/g, '')) || 0;
                let precioOriginal = precioNumero;

                if (precioNumero > 1 && precioNumero < 30000) { 
                    lista.push({
                        plataforma: 'Marketplace',
                        producto: tituloFinal,
                        precio_original: textoPrecioOficial.includes('$') || textoPrecioOficial.toLowerCase().includes('ref') ? `$${precioOriginal}` : `Bs. ${precioOriginal}`,
                        precio_of_limpio: precioNumero,
                        precio_oferta: textoPrecioOficial.includes('$') || textoPrecioOficial.toLowerCase().includes('ref') ? `$${precioNumero}` : `Bs. ${precioNumero}`,
                        tiene_oferta: false,
                        imagen: imagenUrl,
                        enlace: link
                    });
                }
            });
            return lista;
        });
    } catch (e) {
        console.log("⚠️ Error en el módulo de Marketplace:", e.message);
        return [];
    }
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/' && req.method === 'GET') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end("Error interno cargando la interfaz.");
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            }
        });
        return;
    }

    if (parsedUrl.pathname === '/buscar' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        const queryProducto = parsedUrl.query.q || 'iPhone';
        console.log(`\n🚀 Extracción en la nube para: "${queryProducto}"`);
        
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: "new",
                executablePath: '/usr/bin/google-chrome-stable',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-zygote'
                ]
            });
            
            const [pageML, pageFB] = await Promise.all([browser.newPage(), browser.newPage()]);

            const bloquearRecursos = async (page) => {
                await page.setRequestInterception(true);
                page.on('request', (req) => {
                    const tipo = req.resourceType();
                    if (['image', 'stylesheet', 'font', 'media'].includes(tipo)) {
                        req.abort();
                    } else {
                        req.continue();
                    }
                });
            };

            await Promise.all([bloquearRecursos(pageML), bloquearRecursos(pageFB)]);

            console.log("🕵️‍♂️ Minando en modo silencioso...");
            const [resultadosML, resultadosFB] = await Promise.all([
                obtenerDatosMercadoLibre(pageML, queryProducto),
                obtenerDatosMarketplace(pageFB, queryProducto)
            ]);

            await browser.close();

            const todoJunto = [...resultadosML, ...resultadosFB];
            console.log(`✨ Éxito. Capturados: ${todoJunto.length} ítems.`);

            res.writeHead(200);
            res.end(JSON.stringify(todoJunto));

        } catch (error) {
            if (browser) await browser.close();
            console.error("❌ Error General:", error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: "Error en los motores de búsqueda" }));
        }
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ mensaje: "Ruta inválida" }));
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n📡 Servidor en línea en el puerto ${PORT}`);
});