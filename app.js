const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3000;
const TARGET_URL = process.env.TARGET_URL || 'https://www.emx.ae/all-services/track-a-package/step-two';
const APP_ENV = process.env.APP_ENV || 'production';
const DEBUG = process.env.DEBUG === 'True';

const CACHE_DIR = path.join(__dirname, 'cache');

// Ensure main cache folder exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
}

// --- CACHE HELPERS ---
function getTodayCacheDir() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const folder = path.join(CACHE_DIR, `${yyyy}-${mm}-${dd}`);

    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }

    return folder;
}

// --- BROWSER / PAGE HELPERS ---

// Launch Chromium ONCE at startup (lazy: when first needed)
let browserPromise = null;

async function getBrowser() {
    if (!browserPromise) {
        let payload = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        }
        if (APP_ENV !== 'development') {
            
            console.log(APP_ENV);

            payload.executablePath = '/snap/bin/chromium'
        }

        browserPromise = puppeteer.launch(payload);
    }
    return browserPromise;
}

async function newOptimizedPage() {
    const browser = await getBrowser();
    const page = await browser.newPage();

    // Block heavy resources to speed things up
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });

    return page;
}

// Graceful shutdown
async function closeBrowser() {
    if (browserPromise) {
        const browser = await browserPromise;
        await browser.close();
    }
}

process.on('SIGINT', async () => {
    await closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeBrowser();
    process.exit(0);
});

// --- ROUTES ---

app.get('/test', async (req, res) => {
    return res.json({ status: 'ok' });
});

app.get('/track/:awbNumber', async (req, res) => {
    const { awbNumber } = req.params;

    const todayFolder = getTodayCacheDir();
    const cachePath = path.join(todayFolder, `${awbNumber}.json`);

    // 1) Check cache
    if (fs.existsSync(cachePath)) {
        const fileData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const age = Date.now() - fileData.timestamp;

        if (age < 30 * 60 * 1000) {
            return res.json({
                awbNumber,
                events: fileData.events,
                cached: true,
                ageMinutes: Math.round(age / 60000)
            });
        }
    }

    // 2) Scrape again
    const url = `${TARGET_URL}?q=${encodeURIComponent(awbNumber)}`;

    try {
        const page = await newOptimizedPage();

        // Faster load strategy:
        await page.goto(url, {
            waitUntil: 'domcontentloaded',   // don’t wait for networkidle0
            timeout: 30000
        });

        // Make sure the elements are there
        await page.waitForSelector('h2.font-semibold', { timeout: 15000 });

        const events = await page.evaluate(() => {
            const data = [];
            const statusBlocks = document.querySelectorAll('h2.font-semibold');

            statusBlocks.forEach(h2 => {
                const status = h2.innerText.trim();
                const city = h2.nextElementSibling?.innerText.trim() || null;
                const dateTime = h2.nextElementSibling?.nextElementSibling?.innerText.trim() || null;
                data.push({ status, city, dateTime });
            });

            return data;
        });

        await page.close(); // close only the page, keep browser running

        // Save cache
        fs.writeFileSync(
            cachePath,
            JSON.stringify(
                {
                    awbNumber,
                    events,
                    timestamp: Date.now()
                },
                null,
                2
            )
        );

        res.json({
            awbNumber,
            events,
            cached: false
        });
    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: 'Failed to retrieve tracking information' });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
