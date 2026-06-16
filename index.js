const puppeteer = require('puppeteer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const delay = ms => new Promise(res => setTimeout(res, ms));

// ==========================================

// 1. SCRAPER DE MERCADOLIBRE (Ya optimizado)

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

// 2. SCRAPER DE FACEBOOK MARKETPLACE (Optimizado por Descarte de Textos)

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



                // --- NUEVA ESTRATEGIA: EXTRAER TODOS LOS TEXTOS VISIBLES DE LA TARJETA ---

                // Obtenemos los elementos span que contienen los datos reales

                const todosLosSpans = Array.from(enlaceA.querySelectorAll('span'));

                

                // Limpiamos y eliminamos textos duplicados causados por la anidación del HTML de FB

                const textosLimpios = [...new Set(

                    todosLosSpans.map(s => s.innerText ? s.innerText.trim() : "").filter(t => t.length > 0)

                )];



                // Típicamente Marketplace ordena los textos de arriba a abajo así:

                // [0] Precio (Ej: "Bs.F1.500", "$40", "Ref 50")

                // [1] Título del producto (Ej: "Camiseta Nike original")

                // [2] Ubicación (Ej: "Caracas")



                if (textosLimpios.length < 2) return; // Tarjeta rota o incompleta



                // 1. Identificar el Bloque de Precio de forma estricta

                let textoPrecioOficial = textosLimpios.find(t => 

                    t.startsWith('Bs.') || 

                    t.startsWith('Bs.F') || 

                    t.includes('$') || 

                    t.toLowerCase().includes('ref')

                ) || textosLimpios[0]; // Si no tiene letras, asumimos la primera posición



                // 2. Identificar el Título (buscando el texto que NO sea el precio ni la ubicación)

                let tituloFinal = textosLimpios.find(t => 

                    t !== textoPrecioOficial && 

                    !t.toLowerCase().includes('caracas') && 

                    !t.toLowerCase().includes('venezuela') &&

                    t.length > 3

                ) || "Producto de Marketplace";



                // 3. Procesar numéricamente el precio de forma segura (Solo extraer dígitos del bloque de precio)

                let precioNumero = parseInt(textoPrecioOficial.replace(/[^\d]/g, '')) || 0;



                let precioOriginal = precioNumero;

                let tieneOferta = false;



                // Evitar anzuelos de $0, $1 o precios inflados por errores de carga

                if (precioNumero > 1 && precioNumero < 30000) { 

                    lista.push({

                        plataforma: 'Marketplace',

                        producto: tituloFinal,

                        precio_original: textoPrecioOficial.includes('$') || textoPrecioOficial.toLowerCase().includes('ref') ? `$${precioOriginal}` : `Bs. ${precioOriginal}`,

                        precio_of_limpio: precioNumero, // Guardamos el número puro para futuros ordenamientos

                        precio_oferta: textoPrecioOficial.includes('$') || textoPrecioOficial.toLowerCase().includes('ref') ? `$${precioNumero}` : `Bs. ${precioNumero}`,

                        tiene_oferta: tieneOferta,

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

    // 1. NUEVA RUTA PRINCIPAL: Sirve tu página web HTML
    if (parsedUrl.pathname === '/' && req.method === 'GET') {
        // Asegúrate de que tu archivo HTML se llame 'index.html' y esté en la misma carpeta
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

    // 2. RUTA DE BÚSQUEDA OPTIMIZADA
    if (parsedUrl.pathname === '/buscar' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        const queryProducto = parsedUrl.query.q || 'iPhone';
        console.log(`\n🚀 Extracción en la nube para: "${queryProducto}"`);
        
        let browser;
        try {
            // Configuración estricta de bajo consumo para servidores Linux (Render)
            browser = await puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Previene cierres por falta de memoria RAM
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--single-process'
                ]
            });
            
            const [pageML, pageFB] = await Promise.all([browser.newPage(), browser.newPage()]);

            // OPTIMIZACIÓN: Bloquear imágenes y CSS para no gastar RAM del servidor
            const bloquearRecursos = async (page) => {
                await page.setRequestInterception(true);
                page.on('request', (req) => {
                    const tipo = req.resourceType();
                    if (tipo === 'image' || tipo === 'stylesheet' || tipo === 'font' || tipo === 'media') {
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

// NUEVO: process.env.PORT permite que Render asigne el puerto que tenga libre
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n📡 Servidor en línea en el puerto ${PORT}`);
});