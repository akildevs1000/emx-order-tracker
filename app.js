const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3000;
const TARGET_URL = process.env.TARGET_URL || 'https://www.emx.ae/all-services/track-a-package/step-two';

const CACHE_DIR = path.join(__dirname, 'cache');

// Ensure main cache folder exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
}

// Helper function to get today's folder path
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

app.get('/test', async (req, res) => {
    return res.json({ status: 'ok' });
});

app.get('/track/:awbNumber', async (req, res) => {
    const { awbNumber } = req.params;

    const todayFolder = getTodayCacheDir();
    const cachePath = path.join(todayFolder, `${awbNumber}.json`);

    // 1) Check if cached file exists
    if (fs.existsSync(cachePath)) {
        const fileData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

        // Check if file is less than 30 minutes old
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

    // 2) If not cached or cache expired → scrape again
    const url = `${TARGET_URL}?q=${awbNumber}`;

    try {
        const browser = await puppeteer.launch({
            headless: true,
            executablePath: '/snap/bin/chromium', // use snap-installed Chromium
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });

        const events = await page.evaluate(() => {
            const data = [];
            const statusBlocks = document.querySelectorAll('h2.font-semibold');

            statusBlocks.forEach(h2 => {
                const status = h2.innerText.trim();
                const city = h2.nextElementSibling?.innerText.trim();
                const dateTime = h2.nextElementSibling?.nextElementSibling?.innerText.trim();
                data.push({ status, city, dateTime });
            });

            return data;
        });

        await browser.close();

        // Save to file cache
        fs.writeFileSync(
            cachePath,
            JSON.stringify({
                awbNumber,
                events,
                timestamp: Date.now()
            }, null, 2)
        );

        res.json({
            awbNumber,
            events,
            cached: false
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to retrieve tracking information" });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
